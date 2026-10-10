/*==EFFECTS==*/
"use strict";
// ---------- Effect kinds: Levels, Curves and the rest (ROADMAP 4.50 (5)) ----------
// An effect used to be four numbers — hue, saturation, brightness, contrast — drawn through a CSS
// filter. Levels is the tool a roughness or metalness map is worked with, and Curves, a colour
// balance, a gradient map, invert, threshold and posterize are the everyday rest of Photoshop's
// adjustment layers and Substance's filters. Every one of them is a function of ONE TEXEL — its
// value in, its value out, nothing about its neighbours — and that is the property that keeps the
// dirty-rectangle path equal to the whole-sheet one (t52's oracle): a texel's answer cannot depend
// on where a rectangle's edge happened to fall.
//
// So each kind compiles to TABLES, and one small pass applies whichever tables it is given:
//
//   1. per channel     r, g and b each through a 256-entry table        Levels, Curves, Invert, Posterize
//   2. by luma         the texel's luma (a byte) indexes one RGBA table:
//                        "map"    — mix toward its colour by its alpha   Gradient map, Threshold
//                        "offset" — add its signed shift (stored +128)   Colour balance
//   3. keep luma       add back whatever step 2 moved the luma by        Colour balance's "keep luminosity"
//
// The record lives on the effect content as `fx`, beside the four numbers it stands in for:
//   { type: "levels",    rgb: LV, r?: LV, g?: LV, b?: LV }     LV = { inLo, inHi, gamma, outLo, outHi }
//   { type: "curves",    rgb: PTS, r?: PTS, g?: PTS, b?: PTS } PTS = [[x, y], …], bytes, at least two
//   { type: "balance",   shadows: [cr, mg, yb], mids: […], highs: […], keepLum }   each −100…100
//   { type: "gradmap",   stops: [{ t, color, alpha }] }         editor/gradient.js's stops and table
//   { type: "invert" }  { type: "threshold", level }  { type: "posterize", levels }
// A content with no `fx` is the four numbers, drawn exactly as before — every project written
// until now, and every new effect until its kind is changed.
//
// Why the integer care. The pass runs on the GPU wherever it can (`Composite.fxGL`, for the reason
// blend-if's does: on the CPU it is a whole-region readback, a loop and a putImageData — measured
// 2026-09-26 at 329 ms of UI thread per whole-sheet composite at 4096², against 22 on the GPU) and
// on the CPU where it cannot, and the two have to agree on every texel, or a region drawn by one
// would seam against a sheet drawn by the other. So every step is arithmetic float32 does exactly: bytes
// recovered as floor(c·255 + .5); luma as blend-if's integer 2126r + 7152g + 722b (at most
// 2 550 000) made a byte by a floor that is checked back by multiplication; an offset that is an
// integer; and a "map" mix whose rounding point is never within 1/510 of a half, because
// (m − x)·a / 255 cannot land on one. The TABLES are built here, in doubles, once — the GPU only
// looks them up. `tools/t92_adjust.mjs` holds the two passes to zero difference.
//
// This section is the pure half — no DOM, no GL, no App — so the same test holds every table to its
// exact answer under Node.
const Effect = {
  // The kinds, in the order the Effect select offers them. `colour`: offered on the colour channel
  // only — their output has hue, and a single-value map is read back as one of its bytes.
  KINDS: [
    { id: "hsbc",      word: "Hue / saturation / brightness / contrast" },
    { id: "levels",    word: "Levels" },
    { id: "curves",    word: "Curves" },
    { id: "balance",   word: "Colour balance", colour: true },
    { id: "gradmap",   word: "Gradient map", colour: true },
    { id: "invert",    word: "Invert" },
    { id: "threshold", word: "Threshold" },
    { id: "posterize", word: "Posterize" },
  ],
  kind(id){ return Effect.KINDS.find(k => k.id === id) || null; },
  typeOf(c){ return c && c.fx ? String(c.fx.type) : "hsbc"; },
  // The four numbers at rest. A project stores these beside any other kind, so a build that has
  // never heard of `fx` draws nothing, rather than a hue shift left over from before the kind moved.
  HSBC_REST: { hue: 0, sat: 100, bright: 100, contrast: 100 },
  lv(){ return { inLo: 0, inHi: 255, gamma: 1, outLo: 0, outHi: 255 }; },
  line(){ return [[0, 0], [255, 255]]; },
  // A fresh record of a kind, doing nothing yet where that is possible (Levels, Curves, a balance
  // at zero) and the kind's usual starting point where it is not. "hsbc" needs no record: null.
  make(type){
    switch (type) {
      case "levels":    return { type, rgb: Effect.lv() };
      case "curves":    return { type, rgb: Effect.line() };
      case "balance":   return { type, shadows: [0, 0, 0], mids: [0, 0, 0], highs: [0, 0, 0], keepLum: true };
      case "gradmap":   return { type, stops: [{ t: 0, color: "#000000", alpha: 1 }, { t: 1, color: "#ffffff", alpha: 1 }] };
      case "invert":    return { type };
      case "threshold": return { type, level: 128 };
      case "posterize": return { type, levels: 4 };
      default:          return null;
    }
  },
  // A copy that shares nothing with the original, with every number put back in its range — a
  // record read from a file is not trusted to be one this build wrote. A kind this build does not
  // know is kept exactly as it came, so a later build's effect survives a save here; it draws
  // nothing (`compile` answers null) and the panel says why.
  clone(fx){
    if (!fx || typeof fx !== "object") return null;
    const n = (v, lo, hi, d) => { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    const lv = L => L && typeof L === "object" ? { inLo: n(L.inLo, 0, 255, 0), inHi: n(L.inHi, 0, 255, 255), gamma: n(L.gamma, .1, 10, 1),
                                                     outLo: n(L.outLo, 0, 255, 0), outHi: n(L.outHi, 0, 255, 255) } : null;
    const pts = P => Array.isArray(P) ? P.filter(Array.isArray).map(p => [n(p[0], 0, 255, 0), n(p[1], 0, 255, 0)]) : null;
    const tri = v => [0, 1, 2].map(i => n(v && v[i], -100, 100, 0));
    switch (fx.type) {
      case "levels": case "curves": {
        const f = fx.type === "levels" ? lv : pts;
        const out = { type: fx.type, rgb: f(fx.rgb) || (fx.type === "levels" ? Effect.lv() : Effect.line()) };
        for (const k of ["r", "g", "b"]) { const v = f(fx[k]); if (v) out[k] = v; }
        return out;
      }
      case "balance":   return { type: "balance", shadows: tri(fx.shadows), mids: tri(fx.mids), highs: tri(fx.highs), keepLum: fx.keepLum !== false };
      case "gradmap":   return { type: "gradmap", stops: (Array.isArray(fx.stops) ? fx.stops : []).filter(s => s && typeof s === "object").map(s => ({
                          t: n(s.t, 0, 1, 0), color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : "#808080", alpha: n(s.alpha == null ? 1 : s.alpha, 0, 1, 1) })) };
      case "invert":    return { type: "invert" };
      case "threshold": return { type: "threshold", level: Math.round(n(fx.level, 0, 255, 128)) };
      case "posterize": return { type: "posterize", levels: Math.round(n(fx.levels, 2, 255, 4)) };
      default:          return JSON.parse(JSON.stringify(fx));
    }
  },
  // A channel's own Levels or Curves that is back at no change is no setting at all, and goes — in
  // place, and the record is returned. The Channel select calls a channel that has one "adjusted",
  // and undoing a channel's first edit writes the value from before it back through the same setter,
  // which left an identity record behind for the select to go on calling adjusted (review of
  // 4.50 (5), 2026-09-26). Only the exact default counts: a curve through a point on the diagonal
  // changes nothing either, but that point is an anchor someone put there, and it stays.
  tidy(fx){
    if (!fx) return fx;
    const lv = Effect.lv(), line = Effect.line();
    const rest = fx.type === "levels" ? L => Object.keys(lv).every(k => L[k] === lv[k])
               : fx.type === "curves" ? P => P.length === 2 && P.every((p, i) => p[0] === line[i][0] && p[1] === line[i][1])
               : null;
    if (rest) for (const k of ["r", "g", "b"]) if (fx[k] && rest(fx[k])) delete fx[k];
    return fx;
  },

  // ---- the tables ----
  // One byte through one set of levels, GIMP's formula in bytes: the input range stretched to 0…1
  // (a reversed range inverts, an empty one is a hard step at it), the gamma bend — above 1 lifts
  // the midtones, as Photoshop's does — and then the output range, which may run backwards too.
  level(L, x){
    const lo = L.inLo, hi = L.inHi;
    let v = hi !== lo ? (x - lo) / (hi - lo) : (x >= lo ? 1 : 0);
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    if (L.gamma !== 1 && v > 0) v = Math.pow(v, 1 / L.gamma);
    const o = Math.round(L.outLo + v * (L.outHi - L.outLo));
    return o < 0 ? 0 : o > 255 ? 255 : o;
  },
  // Points → 256 entries: a monotone cubic through them (Fritsch–Carlson), so a curve through rising
  // points never dips or overshoots between them — Photoshop's natural spline can, and then clips.
  // Flat past the end points; two points are a straight line; fewer than two is no change.
  curve(pts){
    const out = new Uint8Array(256);
    const byX = new Map();
    for (const p of pts || []) byX.set(Math.round(p[0]), +p[1]);            // one x twice: the later point wins
    const P = [...byX].sort((a, b) => a[0] - b[0]);
    if (P.length < 2) { for (let i = 0; i < 256; i++) out[i] = i; return out; }
    const n = P.length, d = [], m = [];
    for (let k = 0; k < n - 1; k++) d[k] = (P[k + 1][1] - P[k][1]) / (P[k + 1][0] - P[k][0]);
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
    for (let k = 0; k < n - 1; k++) {
      if (d[k] === 0) { m[k] = m[k + 1] = 0; continue; }
      const a = m[k] / d[k], b = m[k + 1] / d[k], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[k] = t * a * d[k]; m[k + 1] = t * b * d[k]; }
    }
    for (let x = 0, k = 0; x < 256; x++) {
      let y;
      if (x <= P[0][0]) y = P[0][1];
      else if (x >= P[n - 1][0]) y = P[n - 1][1];
      else {
        while (x > P[k + 1][0]) k++;
        const h = P[k + 1][0] - P[k][0], t = (x - P[k][0]) / h, t2 = t * t, t3 = t2 * t;
        y = (2 * t3 - 3 * t2 + 1) * P[k][1] + (t3 - 2 * t2 + t) * h * m[k] + (3 * t2 - 2 * t3) * P[k + 1][1] + (t3 - t2) * h * m[k + 1];
      }
      out[x] = Math.max(0, Math.min(255, Math.round(y)));
    }
    return out;
  },
  // Colour balance: a shift per tonal range, each along cyan–red, magenta–green and yellow–blue.
  // Which range a texel is in is read off its LUMA, not off each channel on its own — a pure red is
  // a midtone, not a highlight in red and a shadow in green — through GIMP's three overlapping
  // masks, which sum to 1 at every level, so the shift anywhere is a blend of the three. A full
  // slider moves a channel by 127, half its range (GIMP's goes to 70 %); the table stores it +128.
  balance(fx, lum){
    const a = .25, b = .333, S = fx.shadows, M = fx.mids, H = fx.highs;
    const c01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
    for (let y = 0; y < 256; y++) {
      const l = y / 255;
      const ws = c01((l - b) / -a + .5), wm = c01((l - b) / a + .5) * c01((l + b - 1) / -a + .5), wh = c01((l + b - 1) / a + .5);
      for (let c = 0; c < 3; c++) {
        const d = Math.round((ws * S[c] + wm * M[c] + wh * H[c]) / 100 * 127);
        lum[y * 4 + c] = 128 + Math.max(-127, Math.min(127, d));
      }
      lum[y * 4 + 3] = 255;
    }
  },
  // Posterize: n levels, each taking an equal share of the input (Photoshop's bins, so the two end
  // levels are not half the width of the rest), spread evenly from 0 to 255.
  poster(n, x){ const bin = Math.min(n - 1, Math.floor(x * n / 256)); return Math.round(bin * 255 / (n - 1)); },
  // A record → { buf, per, lum, mode, keep }. `buf` is both tables, 256 × 2 RGBA — exactly the
  // texture the GPU pass samples — with `per` (step 1) its first row and `lum` (step 2) its second.
  // Null for a kind this build does not know, which draws nothing.
  compile(fx){
    if (!fx) return null;
    const buf = new Uint8Array(2048), per = buf.subarray(0, 1024), lum = buf.subarray(1024);
    for (let i = 0; i < 256; i++) { per[i*4] = per[i*4+1] = per[i*4+2] = i; per[i*4+3] = 255; lum[i*4+3] = 255; }
    const T = { buf, per, lum, mode: 0, keep: false };
    const perChan = f => { for (let c = 0; c < 3; c++) for (let i = 0; i < 256; i++) per[i*4+c] = f(c, i); };
    switch (fx.type) {
      case "levels": {
        // each channel's own levels first, then the master's — so the master's output range is the
        // last word, and "Out white 200" bounds every channel whatever the red row says
        const C = [fx.r, fx.g, fx.b], M = fx.rgb || Effect.lv();
        perChan((c, x) => Effect.level(M, C[c] ? Effect.level(C[c], x) : x));
        break;
      }
      case "curves": {
        const M = Effect.curve(fx.rgb), C = [fx.r, fx.g, fx.b].map(p => p ? Effect.curve(p) : null);
        perChan((c, x) => M[C[c] ? C[c][x] : x]);
        break;
      }
      case "invert":    perChan((c, x) => 255 - x); break;
      case "posterize": perChan((c, x) => Effect.poster(fx.levels, x)); break;
      case "threshold":
        T.mode = 1;
        for (let y = 0; y < 256; y++) { const v = y >= fx.level ? 255 : 0; lum[y*4] = lum[y*4+1] = lum[y*4+2] = v; }
        break;
      case "gradmap":   T.mode = 1; lum.set(Gradient.lut(fx.stops)); break;
      case "balance":   T.mode = 2; T.keep = fx.keepLum !== false; Effect.balance(fx, lum); break;
      default:          return null;
    }
    return T;
  },
  // The compiled tables for a content, cached on it under the record's own text: a slider tick on
  // another layer costs nothing here, and a changed record is compiled once. The record goes
  // through `clone` first, so a hand-built or half-written one compiles to something in range.
  table(c){
    if (!c || !c.fx) return null;
    const key = JSON.stringify(c.fx);
    if (c._fxKey !== key) { c._fxT = Effect.compile(Effect.clone(c.fx)); c._fxKey = key; }
    return c._fxT;
  },
  // A texel's luma as a byte: the Rec. 709 weights ×10⁴ (blend-if's integer), rounded. Exact.
  lum(r, g, b){ return Math.floor((r * 2126 + g * 7152 + b * 722 + 5000) / 10000); },
  // The pass on the CPU, in place over straight RGBA bytes; alpha is left alone. It is the reference
  // the GPU pass is held to (t92) and the fallback wherever WebGL is missing or refuses.
  apply(T, d){
    const P = T.per, M = T.lum, mode = T.mode, keep = T.keep, lum = Effect.lum;
    const cl = v => v < 0 ? 0 : v > 255 ? 255 : v;
    for (let k = 0, n = d.length; k < n; k += 4) {
      let r = P[d[k] * 4], g = P[d[k + 1] * 4 + 1], b = P[d[k + 2] * 4 + 2];
      if (mode || keep) {
        const y = lum(r, g, b), m = y * 4;
        if (mode === 1) {
          const a = M[m + 3];
          r += Math.round((M[m] - r) * a / 255); g += Math.round((M[m + 1] - g) * a / 255); b += Math.round((M[m + 2] - b) * a / 255);
        } else if (mode === 2) { r = cl(r + M[m] - 128); g = cl(g + M[m + 1] - 128); b = cl(b + M[m + 2] - 128); }
        if (keep) { const dy = y - lum(r, g, b); r = cl(r + dy); g = cl(g + dy); b = cl(b + dy); }
      }
      d[k] = r; d[k + 1] = g; d[k + 2] = b;
    }
    return d;
  },

  // ---- the curve editor's rules, here so they can be held under Node ----
  // A curve's points stay sorted by x, never two on one x, always at least two. A new point lands
  // between its neighbours; a point moves no further than one step short of either neighbour; the
  // last two cannot be removed. Each returns a new array and leaves the one it was given alone.
  curveAdd(pts, x, y){
    const X = Math.max(0, Math.min(255, Math.round(x))), Y = Math.max(0, Math.min(255, Math.round(y)));
    const P = pts.map(p => p.slice());
    const at = P.findIndex(p => p[0] === X);
    if (at >= 0) { P[at][1] = Y; return { pts: P, i: at }; }
    let i = P.findIndex(p => p[0] > X);
    if (i < 0) i = P.length;
    P.splice(i, 0, [X, Y]);
    return { pts: P, i };
  },
  curveMove(pts, i, x, y){
    const P = pts.map(p => p.slice());
    const lo = i > 0 ? P[i - 1][0] + 1 : 0, hi = i < P.length - 1 ? P[i + 1][0] - 1 : 255;
    P[i] = [Math.max(lo, Math.min(hi, Math.round(x))), Math.max(0, Math.min(255, Math.round(y)))];
    return P;
  },
  curveDrop(pts, i){
    if (pts.length <= 2 || i < 0 || i >= pts.length) return pts.map(p => p.slice());
    return pts.filter((p, k) => k !== i).map(p => p.slice());
  },
  // The point within `tol` of (x, y), nearest first, or −1.
  curveHit(pts, x, y, tol){
    let best = -1, bd = tol * tol;
    pts.forEach((p, i) => { const d = (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y); if (d <= bd) { bd = d; best = i; } });
    return best;
  },
};
/*==ENDEFFECTS==*/
