/*==TIPS==*/
"use strict";
// ---------- Brush tips: the shape each dab is laid in (ROADMAP 4.50 (10)) ----------
//
// Until this every tool painted one shape: a round dab whose edge Hardness softens. Chips, rivet
// heads, splatter and stencilled dots are tip SHAPES, and every comparable tool has them —
// Photoshop's sampled tips, Krita's image brushes, Substance's alphas, the CSP Paintshop's "easily
// extendable" brushes. A tip here is COVERAGE: one byte a texel, 255 where the dab lays everything
// it carries and 0 where it lays nothing. The colour is still the brush's own, so one chip tip is a
// chip in olive, in silver, at Smoothness 200 or on a mask.
//
// Four are built in and made at the dab's own size, so none is ever enlarged: Round (the gradient
// the brush always had — `brushStamp` still draws that one itself, byte for byte), Square, a Rivet
// head with a highlight, and a paint Chip. Any image can be loaded as another: it is read into
// coverage once (`fromImage`), kept at most MAX texels on its longer side, stored in IndexedDB
// beside the decal library, and carried by a settings export as base64.
//
// The arithmetic — the generators, the image reader, the resampler, the records — is plain arrays
// and numbers, so `tools/t131_tips.mjs` lifts this section into Node and holds it to exact answers.
// The canvas and IndexedDB methods at the end are only ever CALLED in the page.
const Tips = {
  // ---- the four built in ----
  BUILT: ["round", "square", "rivet", "chip"],
  NAME: { round: "Round", square: "Square", rivet: "Rivet", chip: "Chip" },
  // A loaded image keeps at most this many texels on its longer side. 256² is 64 KB of coverage and
  // 87 KB in a settings file; a brush over 256 enlarges it, bilinearly, which softens its edge a
  // little at the largest sizes — the same trade Photoshop's sampled tips make.
  MAX: 256,
  isBuilt(id){ return Tips.BUILT.indexOf(id) >= 0; },
  // Hardness is how the two geometric tips feather their edge — the round one exactly as it always
  // has. A rivet, a chip or an image carries its own edge.
  hard(id){ return id === "round" || id === "square"; },
  // A round tip is the same at every angle, so a stroke that turns its dabs draws a round one exactly
  // as before, rather than through a rotation that would only resample it.
  turns(id){ return id !== "round"; },

  // ---- a built-in, as coverage ----
  // n × n bytes, row-major, measured at texel centres. Made at the dab's own size: a tip generated at
  // 16 and drawn at 400 would be a blur.
  //
  // `cover` below is the definition, texel by texel. The Rivet and the Chip are made by loops that
  // give the same bytes faster (`rivetInto`, `chipInto`): asked texel by texel, a Chip at 400 took
  // 11.7 ms and a Rivet 8.5 once warm, and 25 / 21 ms the first time in a session, measured in Node
  // 2026-09-26 — the first dab after a change of tip, size or hardness paid that (4.50 (10)'s review).
  // Both are `cover`'s bytes at every size from 1 to 420 (measured), and t131 holds them to it at 114.
  make(kind, n, hard){
    n = Math.max(1, Math.round(n));
    const out = new Uint8Array(n * n), c = n / 2, k = 2 / n;
    const h = Math.max(0, Math.min(1, hard == null ? 1 : +hard || 0)) * .95;
    if (kind === "chip") return Tips.chipInto(out, n);
    if (kind === "rivet" && n >= 5) return Tips.rivetInto(out, n);
    for (let y = 0; y < n; y++) {
      const v = (y + .5 - c) * k;
      for (let x = 0; x < n; x++) out[y * n + x] = Math.round(255 * Tips.cover(kind, (x + .5 - c) * k, v, h, n));
    }
    return out;
  },
  // The Chip as `cover` makes it, sparing the angle where the answer does not depend on it: a texel
  // further in than the flake's shortest radius less a texel is all of it, one further out than its
  // longest plus a texel none of it, and only the ring between asks atan2 — 60 % of the texels, 5.0 ms
  // at 400 warm (Node). Each bound keeps 1e-9 of room, so no texel it decides is one `cover` could
  // round the other way.
  chipInto(out, n){
    Tips.chipAt(0);                                      // the table, and its extremes
    const c = n / 2, k = 2 / n, e = n / 2, N = Tips.CHIP_N, L = Tips._chip, K = N / (2 * Math.PI);
    const inR = Tips._chipLo - 1 / n - 1e-9, in2 = inR > 0 ? inR * inR : -1, outR = Tips._chipHi + 1 / n + 1e-9, out2 = outR * outR;
    for (let y = 0; y < n; y++) {
      const v = (y + .5 - c) * k, v2 = v * v, row = y * n;
      if (v2 >= out2) continue;
      for (let x = 0; x < n; x++) {
        const u = (x + .5 - c) * k, r2 = u * u + v2;
        if (r2 >= out2) continue;
        if (r2 <= in2) { out[row + x] = 255; continue; }
        const f = (Math.atan2(v, u) + Math.PI) * K, i = Math.max(0, Math.min(N - 1, Math.floor(f)));
        const t = (L[i] + (L[i + 1] - L[i]) * (f - i) - Math.hypot(u, v)) * e + .5;
        out[row + x] = Math.round(255 * (t < 0 ? 0 : t > 1 ? 1 : t));
      }
    }
    return out;
  },
  // The Rivet the same way: outside its edge nothing, its rim (past .76 of the radius, a texel inside
  // the edge) all of it, the dome its shade without a square root unless the texel is under the
  // highlight — which leaves the edge and the highlight to `cover`'s own arithmetic. 1.4 ms at 400
  // warm, from 8.5 (Node). From n = 5, where the rim is wider than the edge's texel.
  rivetInto(out, n){
    const c = n / 2, k = 2 / n, e = n / 2, ep = 1e-9, rim2 = .76 * .76;
    const out2 = (1 + 1 / n + ep) * (1 + 1 / n + ep), solid = 1 - 1 / n - ep, solid2 = solid * solid;
    for (let y = 0; y < n; y++) {
      const v = (y + .5 - c) * k, v2 = v * v, row = y * n, hv = v + .3, hv2 = hv * hv;
      if (v2 >= out2) continue;
      for (let x = 0; x < n; x++) {
        const u = (x + .5 - c) * k, r2 = u * u + v2;
        if (r2 >= out2) continue;
        if (r2 > rim2 + ep && r2 <= solid2) { out[row + x] = 255; continue; }
        if (r2 < rim2 - ep) {                               // the dome, whose edge factor is 1 here
          const s = (u + v) / 1.2, shade = .84 + .1 * (s < -1 ? -1 : s > 1 ? 1 : s), hu = u + .3;
          let val = shade;
          if (hu * hu + hv2 < .09 + ep) {
            const hd = Math.hypot(hu, hv) / .3, hl = hd < 1 ? (1 - hd * hd) * (1 - hd * hd) : 0;
            val = Math.max(0, shade - .66 * hl);
          }
          out[row + x] = Math.round(255 * val);
          continue;
        }
        const r = Math.hypot(u, v);
        let t = (1 - r) * e + .5;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        out[row + x] = Math.round(255 * (t * Tips.rivet(u, v, r)));
      }
    }
    return out;
  },
  // One texel of a built-in, 0…1. (u, v) run −1…1 across the tip, y down. `h` is where a feathered
  // edge starts to fade, as a fraction of the radius: Hardness × .95, the numbers the round gradient
  // has always used (its inner stop at r · hardness · .95). `n` is the size in texels, which is what
  // one texel of antialiasing on a hard edge is measured in.
  cover(kind, u, v, h, n){
    const ramp = d => d <= h ? 1 : d >= 1 ? 0 : (1 - d) / (1 - h);
    const edge = t => Math.max(0, Math.min(1, t * n / 2 + .5));        // t: how far inside the edge
    if (kind === "square") return ramp(Math.max(Math.abs(u), Math.abs(v)));
    const r = Math.hypot(u, v);
    if (kind === "rivet") return edge(1 - r) * Tips.rivet(u, v, r);
    if (kind === "chip") return edge(Tips.chipAt(Math.atan2(v, u)) - r);
    return ramp(r);
  },
  // A domed rivet head lit from the upper left, as coverage: the rim solid, the dome a little lighter
  // towards the light, the highlight lightest of all. Lighter is "lays less", so painted darker than
  // the panel under it the panel shows through the highlight — how Photoshop's sampled rivet brushes
  // read too. Rim 255, dome 192–236, highlight down to 33 (t131).
  rivet(u, v, r){
    if (r > .76) return 1;
    const shade = .84 + .1 * Math.max(-1, Math.min(1, (u + v) / 1.2));
    const hd = Math.hypot(u + .3, v + .3) / .3, hl = hd < 1 ? (1 - hd * hd) * (1 - hd * hd) : 0;
    return Math.max(0, shade - .66 * hl);
  },
  // A flake of paint: a blob whose edge wanders with the angle — seven harmonics [k, amplitude,
  // phase] at fixed values, so every chip is the same flake and Angle jitter and Size jitter are
  // what make a scatter of them look like chipping rather than a stamp.
  CHIP: [[2, .11, .4], [3, .09, 2.2], [4, .06, 4.1], [5, .05, 1.3], [7, .035, 5.6], [9, .025, 3.1], [11, .02, .9]],
  chipR(t){
    let r = .72;
    for (let i = 0; i < Tips.CHIP.length; i++) { const c = Tips.CHIP[i]; r += c[1] * Math.sin(c[0] * t + c[2]); }
    return Math.max(.3, Math.min(.98, r));
  },
  // ...read from a table of it over the angle. Seven sines a texel made the Chip the one tip too slow
  // to make at the largest sizes — 47 ms at 400 texels against the Rivet's 9, and 11 from the table,
  // measured in Node 2026-09-26. 4096 steps round it put straight-line interpolation within 1.4·10⁻⁴
  // of the radius over 200 001 angles, all of it beside the clamp (2·10⁻⁶ away from it) — under a
  // thirtieth of a texel at 400.
  CHIP_N: 4096,
  _chip: null, _chipLo: 0, _chipHi: 0,                   // the table, and its shortest and longest radius
  chipAt(t){
    const N = Tips.CHIP_N;
    let L = Tips._chip;
    if (!L) {
      L = Tips._chip = new Float64Array(N + 1);
      for (let i = 0; i <= N; i++) L[i] = Tips.chipR(-Math.PI + 2 * Math.PI * i / N);
      Tips._chipLo = Math.min(...L); Tips._chipHi = Math.max(...L);
    }
    const f = (t + Math.PI) * N / (2 * Math.PI), i = Math.max(0, Math.min(N - 1, Math.floor(f)));
    return L[i] + (L[i + 1] - L[i]) * (f - i);
  },

  // ---- an image the user loads, as coverage ----
  // `px` is RGBA, w × h. People's tip images come in three conventions and all three are read:
  //  * a shape on a TRANSPARENT background — alpha is the shape. Ink darker than mid-grey counts by
  //    how dark it is (Photoshop's reading, so a grey highlight lays less), and ink lighter than
  //    that by how light, so white-on-transparent works where Photoshop would read nothing;
  //  * DARK INK ON LIGHT PAPER, Photoshop's and GIMP's convention;
  //  * LIGHT ON DARK, Substance's alphas.
  // For an opaque image the paper is the border's mean, so either polarity comes out the right way
  // round, and the ink is stretched so the paper is 0 and the strongest ink 255 — a JPEG's off-white
  // paper would otherwise be a faint square round every dab. The last 3 % of the span above the paper
  // is noise, not ink. The result is cropped to what it covers and brought down to MAX (`fit`).
  // Null when there is nothing on it to use.
  //
  // **Which reading, decided by how much of the image is see-through — not by one texel.** Deciding
  // on ANY texel under alpha 250, as this did at first, read a black dot on white paper with one
  // transparent corner inverted: the paper laid everything and the ink nothing, uncropped, and the
  // status line called it a tip (4.50 (10)'s review, 2026-09-26). Rounded screenshot corners and an
  // antialiased edge pixel did the same. So transparency is the shape when at least SEE of the image
  // is see-through on average — a disc touching all four edges is a fifth — or when the opaque part
  // has no ink on paper to read; otherwise the texels that are not opaque are paper showing through
  // (`inked`): a corner, rounded corners, an edge, a 1-texel frame round anything over 40 across.
  SEE: .1,
  fromImage(px, w, h){
    if (!(w > 0 && h > 0) || !px || px.length < w * h * 4) return null;
    const n = w * h;
    let sa = 0, lucent = false;
    for (let i = 3; i < n * 4; i += 4) { sa += px[i]; if (px[i] < 250) lucent = true; }
    const cov = !lucent ? Tips.inked(px, w, h)
      : 1 - sa / (255 * n) < Tips.SEE ? Tips.inked(px, w, h) || Tips.shaped(px, w, h)
      : Tips.shaped(px, w, h);
    return cov && Tips.fit(cov, w, h);
  },
  lum(px, i){ return (px[i] * 2126 + px[i + 1] * 7152 + px[i + 2] * 722) / 10000; },
  // A shape on a transparent background: alpha is the shape, and its ink counts by how dark it is
  // when it is dark on the whole and by how light when light. Null when it has nothing on it.
  shaped(px, w, h){
    const n = w * h, cov = new Uint8Array(n);
    let sa = 0, sl = 0;
    for (let i = 0; i < n; i++) { const a = px[i * 4 + 3]; sa += a; sl += a * Tips.lum(px, i * 4); }
    if (!sa) return null;
    const dark = sl / sa < 128;
    for (let i = 0; i < n; i++) {
      const L = Tips.lum(px, i * 4);
      cov[i] = Math.round(px[i * 4 + 3] * (dark ? 255 - L : L) / 255);
    }
    return cov;
  },
  // Ink on paper: the paper is the border's colour, and a texel that is not opaque is that paper
  // showing through it, so a transparent corner lays nothing. A border that is itself see-through —
  // a transparent frame round the paper — is passed over a ring at a time. Null for a flat image.
  // Opaque is alpha 250 and up, as it always was here, so an image with none below that is read to
  // the same bytes as before.
  inked(px, w, h){
    const n = w * h, cov = new Uint8Array(n);
    let P = -1;
    for (let k = 0; 2 * k < Math.min(w, h) && P < 0; k++) {
      const x1 = w - 1 - k, y1 = h - 1 - k;
      let sl = 0, sal = 0, sa = 0, op = 0, m = 0;
      const rim = i => { const a = px[i * 4 + 3], L = Tips.lum(px, i * 4); sl += L; sal += a * L; sa += a; if (a >= 250) op++; m++; };
      for (let x = k; x <= x1; x++) { rim(k * w + x); if (y1 > k) rim(y1 * w + x); }
      for (let y = k + 1; y < y1; y++) { rim(y * w + k); if (x1 > k) rim(y * w + x1); }
      // An opaque rim is the plain mean it always was; a partly clear one is weighed by alpha, and one
      // mostly clear is not paper at all.
      if (op === m) P = sl / m;
      else if (sa >= 127.5 * m) P = sal / sa;
    }
    if (P < 0) return null;
    const light = P >= 128;
    const L = i => { const a = px[i * 4 + 3], l = Tips.lum(px, i * 4); return a >= 250 ? l : (a * l + (255 - a) * P) / 255; };
    let ink = P;
    for (let i = 0; i < n; i++) { const l = L(i); if (light ? l < ink : l > ink) ink = l; }
    const span = Math.abs(P - ink), floor = span * .03;
    if (span < 8) return null;                           // a flat image: no ink to find
    for (let i = 0; i < n; i++) {
      const t = (light ? P - L(i) : L(i) - P) - floor;
      cov[i] = t <= 0 ? 0 : Math.min(255, Math.round(t * 255 / (span - floor)));
    }
    return cov;
  },
  // Crop to the texels that lay anything — a tip drawn in the middle of a big canvas would otherwise
  // be a small dab at every Size — and bring the longer side down to MAX.
  fit(cov, w, h){
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (cov[y * w + x]) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1, cut = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) cut.set(cov.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + cw), y * cw);
    const k = Math.min(1, Tips.MAX / Math.max(cw, ch));
    if (k === 1) return { w: cw, h: ch, cov: cut };
    const W = Math.max(1, Math.round(cw * k)), H = Math.max(1, Math.round(ch * k));
    return { w: W, h: H, cov: Tips.scale(cut, cw, ch, W, H) };
  },

  // ---- a tip at any size ----
  // Separable. Shrinking averages every source texel an output texel's footprint covers, weighted by
  // how much of it (a box), so a 256-texel chip laid at 20 keeps its outline instead of aliasing into
  // scattered texels; enlarging is bilinear. At the same size it is an exact copy.
  scale(src, w, h, W, H){
    const wx = Tips.weights(w, W), wy = Tips.weights(h, H);
    const mid = new Float32Array(W * h), out = new Uint8Array(W * H);
    for (let y = 0; y < h; y++) for (let x = 0; x < W; x++) {
      const r = wx[x];
      let s = 0;
      for (let i = 0; i < r.length; i += 2) s += src[y * w + r[i]] * r[i + 1];
      mid[y * W + x] = s;
    }
    for (let y = 0; y < H; y++) {
      const r = wy[y];
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let i = 0; i < r.length; i += 2) s += mid[r[i] * W + x] * r[i + 1];
        out[y * W + x] = Math.max(0, Math.min(255, Math.round(s)));
      }
    }
    return out;
  },
  // For each output index along one axis, the source indices that feed it and their weights, flat as
  // [i, k, i, k, …]; the weights of each sum to 1.
  weights(n, N){
    const out = [], f = n / N;
    for (let j = 0; j < N; j++) {
      const row = [];
      if (N <= n) {
        const a = j * f, b = (j + 1) * f;
        for (let i = Math.floor(a); i < Math.ceil(b) && i < n; i++) {
          const k = (Math.min(b, i + 1) - Math.max(a, i)) / f;
          if (k > 0) row.push(i, k);
        }
      } else {
        const s = Math.max(0, Math.min(n - 1, (j + .5) * f - .5)), i = Math.floor(s), t = s - i;
        row.push(i, 1 - t);
        if (t > 0 && i + 1 < n) row.push(i + 1, t);
      }
      out.push(row);
    }
    return out;
  },

  // ---- records ----
  // FNV-1a over the size and the bytes: what makes two tips with one id the same tip, and what the
  // stamp's cache key carries, so a tip replaced under its id is redrawn.
  sum(cov, w, h){
    let x = 0x811c9dc5;
    const eat = b => { x ^= b & 255; x = Math.imul(x, 16777619) >>> 0; };
    eat(w); eat(w >> 8); eat(h); eat(h >> 8);
    for (let i = 0; i < cov.length; i++) eat(cov[i]);
    return (x >>> 0).toString(16);
  },
  b64(u8){
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  },
  unb64(s){
    const b = atob(s), u8 = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i);
    return u8;
  },
  // A tip as it is kept, from whatever held it — IndexedDB (bytes) or a settings file (base64) —
  // checked, so a hand-edited file cannot hand the stamp a tip whose bytes do not match its size.
  // Null for anything that is not one.
  record(r){
    if (!r || typeof r.id !== "string" || !/^t[0-9a-z]{1,24}$/.test(r.id)) return null;
    const w = r.w | 0, h = r.h | 0;
    let cov = r.cov;
    if (typeof cov === "string") {
      // atob throwing IS the answer here: the text is not base64, so this is not a tip.
      try { cov = Tips.unb64(cov); } catch (e) { return null; }
    }
    if (!(cov instanceof Uint8Array) || !(w > 0 && h > 0 && w <= Tips.MAX && h <= Tips.MAX) || cov.length !== w * h) return null;
    return { id: r.id, name: String(r.name || "Tip").slice(0, 60), w, h, cov, sum: Tips.sum(cov, w, h) };
  },

  // ---- the cursor's outline (ROADMAP 3.41 (2)) ----
  // A tip's coverage traced where it crosses half its peak — the outline Photoshop draws for a sampled
  // tip — as segments [x0, y0, x1, y1, …] about the tip's centre, its longer side spanning −1 … 1 and y
  // down, so a cursor draws it at any size by scaling by half that size. Traced once per tip and
  // cached: a built-in at OUTLINE texels a side (its shape does not depend on its size), a loaded image
  // at its own. The Round and the Square are drawn as their circle and square instead: Hardness
  // feathers them, and at half a soft one would read smaller than its Size.
  OUTLINE: 128,
  _outline: new Map(),
  outline(T){
    let o = Tips._outline.get(T.key);
    if (o) return o;
    o = T.cov ? Tips.trace(T.cov, T.w, T.h) : Tips.trace(Tips.make(T.id, Tips.OUTLINE, 1), Tips.OUTLINE, Tips.OUTLINE);
    if (Tips._outline.size >= 32) Tips._outline.clear();            // a tip edited over and over
    Tips._outline.set(T.key, o);
    return o;
  },
  // Marching squares over the texel centres of `cov` (W × H bytes), zero outside, at half its peak.
  // Cell corners a, b, c, d run clockwise from the top left; a saddle is split by the cell's mean.
  trace(cov, W, H){
    let peak = 0;
    for (let i = 0; i < cov.length; i++) if (cov[i] > peak) peak = cov[i];
    if (!peak) return new Float32Array(0);
    const t = peak / 2, out = [], M = Math.max(W, H) / 2, ox = W / 2 - .5, oy = H / 2 - .5;
    const at = (x, y) => x < 0 || y < 0 || x >= W || y >= H ? 0 : cov[y * W + x];
    const P = (x0, y0, p, x1, y1, q) => { const f = (t - p) / (q - p); return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]; };
    const seg = (u, v) => out.push((u[0] - ox) / M, (u[1] - oy) / M, (v[0] - ox) / M, (v[1] - oy) / M);
    for (let y = -1; y < H; y++) for (let x = -1; x < W; x++) {
      const a = at(x, y), b = at(x + 1, y), c = at(x + 1, y + 1), d = at(x, y + 1);
      const k = (a > t ? 8 : 0) | (b > t ? 4 : 0) | (c > t ? 2 : 0) | (d > t ? 1 : 0);
      if (k === 0 || k === 15) continue;
      const T = () => P(x, y, a, x + 1, y, b), R = () => P(x + 1, y, b, x + 1, y + 1, c);
      const B = () => P(x, y + 1, d, x + 1, y + 1, c), L = () => P(x, y, a, x, y + 1, d);
      const mid = (a + b + c + d) / 4 > t;
      switch (k) {
        case 1: case 14: seg(L(), B()); break;
        case 2: case 13: seg(B(), R()); break;
        case 3: case 12: seg(L(), R()); break;
        case 4: case 11: seg(T(), R()); break;
        case 6: case 9: seg(T(), B()); break;
        case 7: case 8: seg(L(), T()); break;
        case 5: if (mid) { seg(L(), T()); seg(B(), R()); } else { seg(T(), R()); seg(L(), B()); } break;
        case 10: if (mid) { seg(T(), R()); seg(L(), B()); } else { seg(L(), T()); seg(B(), R()); } break;
      }
    }
    return new Float32Array(out);
  },
  // Which way a cursor shows the tip turned: its Angle, and — mid-stroke, with Follow on — the way the
  // stroke is heading (`head`, radians in the frame the dabs are drawn in), as `Pen.dab` turns a dab;
  // never its jitter, which is per dab. A round tip does not turn.
  cursorTurn(T, b, head){
    if (!T.turns) return 0;
    return (+b.angle || 0) * Math.PI / 180 + (b.follow && head != null ? head : 0);
  },

  // ---- the library: the tips a user has loaded ----
  // In memory for the stamp, which is synchronous; in IndexedDB for the next visit, as `tipIndex`
  // plus a `tip:<id>` each — the decal library's arrangement; in a settings export as base64.
  lib: new Map(),
  ready: false,                                        // the IndexedDB copy has been read
  _built: {},
  // What a tip id means to the stamp. An id that names nothing is the round tip — the brush still
  // paints, and `BrushPanel` says why it is round when the library says the tip is gone.
  get(id){
    if (Tips.isBuilt(id))
      return Tips._built[id] || (Tips._built[id] = { id, key: id, name: Tips.NAME[id], turns: Tips.turns(id), hard: Tips.hard(id), cov: null });
    const t = Tips.lib.get(id);
    return t ? { id, key: id + ":" + t.sum, name: t.name, turns: true, hard: false, w: t.w, h: t.h, cov: t.cov } : Tips.get("round");
  },
  // The tip the brush in hand actually lays. A Panel line's bump is analytic, added into a height
  // field, and has none: whatever tip that tool's row holds, it is round.
  of(b){ return Tips.get(b && b.tool !== "height" ? b.tip : "round"); },
  known(id){ return Tips.isBuilt(id) || Tips.lib.has(id); },
  // Whether a stored setting may name this tip: a built-in, one in the library — or, before the
  // library has been read at boot, any id shaped like one of its own, which is checked once it has.
  valid(id){ return typeof id === "string" && (Tips.known(id) || (!Tips.ready && /^t[0-9a-z]{1,24}$/.test(id))); },
  serialise(){ return [...Tips.lib.values()].map(t => ({ id: t.id, name: t.name, w: t.w, h: t.h, cov: Tips.b64(t.cov) })); },
  // A settings file's tips go into the library NOW, so the brush rows applied after this one find
  // them, and into IndexedDB behind it. A tip already here with the same bytes is left as it is.
  adopt(list){
    const fresh = [];
    for (const r of Array.isArray(list) ? list : []) {
      const rec = Tips.record(r);
      if (!rec) continue;
      const had = Tips.lib.get(rec.id);
      if (had && had.sum === rec.sum) continue;
      Tips.lib.set(rec.id, rec);
      fresh.push(rec);
    }
    return { added: fresh.length, done: fresh.length ? Tips.persist(fresh) : Promise.resolve() };
  },

  // ---- the page's half: IndexedDB and the canvas ----
  async load(){
    const idx = (await idbGet("tipIndex")) || [];
    for (const row of Array.isArray(idx) ? idx : []) {
      const rec = row && Tips.record(await idbGet("tip:" + row.id));
      if (rec) Tips.lib.set(rec.id, rec);
    }
    Tips.ready = true;
    return Tips.lib.size;
  },
  // **The index is read before it is written, never rebuilt from this page's memory** — the decal
  // library's rule (`DecalLib.add / update / remove`). `Tips.lib` is read once at boot, so a second
  // tab opened before another added a tip does not hold it; writing its own list dropped that tip
  // from the next visit and left its `tip:<id>` record in IndexedDB with no row pointing at it, for
  // good (4.50 (10)'s review, 2026-09-26). Rows are merged by id instead. And the writes of one page
  // go one at a time (`_q`), so two in flight — a settings file adopted while a tip is added — cannot
  // each read the index before the other has written it.
  _q: Promise.resolve(),
  async index(){
    const idx = await idbGet("tipIndex");
    return Array.isArray(idx) ? idx.filter(r => r && typeof r.id === "string") : [];
  },
  write(fn){
    const run = Tips._q.then(fn);
    Tips._q = run.then(() => null, e => e);              // the caller hears a failure through `run`; the queue only waits for it
    return run;
  },
  persist(recs){
    return Tips.write(async () => {
      for (const r of recs) await idbSet("tip:" + r.id, { id: r.id, name: r.name, w: r.w, h: r.h, cov: r.cov });
      const rows = new Map((await Tips.index()).map(r => [r.id, r]));
      for (const r of recs) rows.set(r.id, { id: r.id, name: r.name, w: r.w, h: r.h });
      await idbSet("tipIndex", [...rows.values()]);
    });
  },
  async add(t, name){
    const id = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const rec = t && Tips.record({ id, name, w: t.w, h: t.h, cov: t.cov });
    if (!rec) return null;
    Tips.lib.set(id, rec);
    await Tips.persist([rec]);
    return id;
  },
  async remove(id){
    if (!Tips.lib.delete(id)) return false;
    await Tips.write(async () => {
      await idbDel("tip:" + id);
      await idbSet("tipIndex", (await Tips.index()).filter(r => r.id !== id));
    });
    return true;
  },
  // A tip in the brush's colour (or value) at the brush's size: the canvas `stampAt` draws every dab
  // from, scaled at draw time for pressure and jitter exactly as the round one is. Its longer side is
  // the brush Size; an image keeps its proportions.
  stamp(T, d, hard, col){
    const n = Math.max(1, Math.round(d));
    let W = n, H = n;
    if (T.cov) { if (T.w >= T.h) H = Math.max(1, Math.round(n * T.h / T.w)); else W = Math.max(1, Math.round(n * T.w / T.h)); }
    const cov = Tips.coverage(T, W, H, hard);
    const rgb = Tips.rgb(col), c = mkCanvas(W, H), g = ctx2d(c), img = g.createImageData(W, H), p = img.data;
    for (let i = 0, j = 0; i < cov.length; i++, j += 4) { p[j] = rgb[0]; p[j + 1] = rgb[1]; p[j + 2] = rgb[2]; p[j + 3] = cov[i]; }
    g.putImageData(img, 0, 0);
    return c;
  },
  // The tip's coverage at W × H, kept for the last one asked. The colour is not in it, so a new
  // colour — the commonest change between two strokes — recolours this rather than re-making it:
  // 1.9 ms at 400², against 9 ms to make a Rivet there (Node, 2026-09-26). Hardness is in the key
  // only for the two tips it shapes.
  _cov: null,
  coverage(T, W, H, hard){
    const key = T.key + "|" + W + "x" + H + "|" + (T.hard ? hard : "");
    if (Tips._cov && Tips._cov.key === key) return Tips._cov.cov;
    const cov = T.cov ? Tips.scale(T.cov, T.w, T.h, W, H) : Tips.make(T.id, W, hard);
    Tips._cov = { key, cov };
    return cov;
  },
  // The brush's ink as bytes, from the three spellings `brushStamp` uses.
  rgb(col){
    const s = String(col || "");
    let m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) { const v = parseInt(m[1], 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; }
    m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return [...m[1]].map(c => parseInt(c + c, 16));
    m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(s);
    return m ? [+m[1], +m[2], +m[3]] : [255, 255, 255];
  },
  // How far a dab reaches from its centre: half its size, or — turned — half its diagonal, so the
  // undo tiles and the stroke buffer's dirty rectangle take in a turned square's corners.
  reach(stamp, sz, turn){
    if (!turn) return sz / 2;
    const m = Math.max(stamp.width, stamp.height);
    return Math.hypot(sz * stamp.width / m, sz * stamp.height / m) / 2;
  },
  // Draw the stamp centred on (x, y), its longer side `sz`, turned by `turn` radians. Unturned and
  // square — every round dab, and any dab with no angle — it is the one drawImage `stampAt` always
  // made, number for number.
  lay(g, stamp, x, y, sz, turn){
    const W = stamp.width, H = stamp.height;
    if (!turn && W === H) { g.drawImage(stamp, x - sz / 2, y - sz / 2, sz, sz); return; }
    const k = sz / Math.max(W, H), w = W * k, h = H * k;
    g.save();
    g.translate(x, y);
    if (turn) g.rotate(turn);
    g.drawImage(stamp, -w / 2, -h / 2, w, h);
    g.restore();
  },
  // The same dab cut to a stencil — the painted part(s) of a masked stroke: laid into a scratch its
  // reach `D` across, cut `destination-in` by the stencil's window over it (`mk` scales sheet texels
  // to the stencil's), and drawn into `g` at (x, y). With `tint` (bytes) the dab is recoloured there
  // too, `source-in`, keeping its coverage — the colour along the stroke (ROADMAP 4.56), which varies
  // per dab where the stamp is made once per stroke. Either may be absent. A tinted dab costs the
  // masked dab's three draws, and only a brush whose colour cycles pays them.
  layIn(g, stamp, x, y, sz, turn, D, mask, mk, tint){
    const tmp = stampClipBuf(Math.ceil(D) + 1), tg = ctx2d(tmp);
    tg.clearRect(0, 0, tmp.width, tmp.height);
    tg.globalCompositeOperation = "source-over"; tg.globalAlpha = 1;
    Tips.lay(tg, stamp, D / 2, D / 2, sz, turn);
    if (mask) {
      tg.globalCompositeOperation = "destination-in";
      tg.drawImage(mask, (x - D / 2) * mk.x, (y - D / 2) * mk.y, D * mk.x, D * mk.y, 0, 0, D, D);
    }
    if (tint) {
      tg.globalCompositeOperation = "source-in";
      tg.fillStyle = "rgb(" + tint[0] + "," + tint[1] + "," + tint[2] + ")";
      tg.fillRect(0, 0, Math.ceil(D) + 1, Math.ceil(D) + 1);
    }
    tg.globalCompositeOperation = "source-over";
    g.drawImage(tmp, 0, 0, D, D, x - D / 2, y - D / 2, D, D);
  },
  // The same dab on a square S texels across, for the Clone, which scales what it is handed to its
  // whole-texel patch. Unturned and square it IS the stamp. Otherwise it is drawn into the top-left
  // S × S of one scratch canvas, and `_side` says how much of it that is.
  //
  // **One scratch, made once for the stamp's largest dab** (§3.6). It used to be remade whenever S
  // changed — and under size jitter or a pen, S is the dab's own whole-texel size, so that was a
  // canvas for nearly every dab: 38 for a 26-dab Clone stroke (4.50 (10)'s review, 2026-09-26). No
  // dab of a stamp reaches past its diagonal, so the scratch is made that big (and 2 texels over) and
  // grows only for a larger stamp. `_v` counts redraws: the Clone caches its tone weights against the
  // canvas it was handed, and this is one canvas for every dab.
  _shape: null,
  shape(stamp, S, sz, turn){
    if (!turn && stamp.width === stamp.height) return stamp;
    const M = Math.max(S, Math.ceil(Math.hypot(stamp.width, stamp.height)) + 2);
    let c = Tips._shape;
    if (!c || c.width < M) c = Tips._shape = mkCanvas(M, M);
    const g = ctx2d(c), E = Math.min(c.width, Math.max(c._e | 0, S + 2));
    g.clearRect(0, 0, E, E);                             // what the last dab drew, and this one's square
    Tips.lay(g, stamp, S / 2, S / 2, sz, turn);
    c._e = S + 2; c._side = S;
    c._v = (c._v | 0) + 1;
    return c;
  },
};
/*==ENDTIPS==*/
