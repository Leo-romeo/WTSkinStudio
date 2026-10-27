// Pattern fills and procedural noise (ROADMAP 4.50 (7) and (8)).
//
// WHY THIS EXISTS. Both fills have answers that are exact, and neither is visible in a wireframe:
// a noise is only seamless if the same point of the vehicle reads the same value on whichever UV
// island it sits, only reproducible if the same seed is the same noise in every worker, and only a
// usable "detail" slider if eight octaves read with the contrast one does. A tri-planar pattern is
// only right if a face looking along +x shows the tile's yz projection, a slanted one blends two,
// and a tile shrunk to a few texels is filtered rather than aliased. None of that is a matter of
// taste, so all of it is held here, in two halves:
//
//   Node, on the pure `/*==GRADIENT==*/` + `/*==PROCEDURAL==*/` sections — what the pool's workers run:
//   * the noise is deterministic, the seed changes it, every kind stays in 0…1 centred on .5, and
//     its spread is the same at one octave and at eight (a fixed divisor gives 1.7× less at eight);
//   * the scale is in metres (the field at scale 2s and position 2p is the field at s and p,
//     exactly), streaks are stretched along the up axis and nothing else is;
//   * `evalNoise` reads the same value at the same position on two islands, a band handed only its
//     own rows equals the same rows of the whole sheet, a region equals the whole, levels with
//     From = To cut it to exactly two colours, and a texel with no position is transparent;
//   * a pattern record is clamped, the mip chain halves by 2×2 boxes and is premultiplied (a
//     keyed-out tile shrinks to white at half alpha, not to grey), a tap wraps a whole tile;
//   * `evalTri` shows each face its own axis's projection, blends a slanted one by |n|^sharp, and
//     drops a projection whose weight is under a thousandth; a tile shrunk sixteen-fold is
//     filtered to its mean; a band handed its rows and the row either side equals the whole; the UV
//     matrix repeats a whole tile;
//   * since the review of 2026-09-26: a +z face shows, texel for texel, what the SHEET shows at the
//     same point at seven angles and offsets — the two kinds turn and slide one way; islands whose
//     UVs touch but sit metres apart keep their own stripes to the rim (the footprint takes the
//     nearer side); a pattern on the sheet meets itself where the Repeats tooltip says it does.
//
//   Headless Chrome, on the real page (t74's quads, one pair of them at the SAME position):
//   * the position bake carries the normal plane, padded and packed in the bake POOL byte for byte
//     as this thread would, a unit normal in every gutter; a noise fill is evaluated in the fill
//     POOL's workers, and its sheet is byte-for-byte the main thread's own evaluation of the same
//     bake; the two islands at one position read the same noise; the composite shows it;
//   * while a new record is worked on the layer keeps its last sheet, only one evaluation runs per
//     content, a failure is reported once and latched, export's `ensure()` waits for the current
//     record, and convert-to-paint keeps the pixels;
//   * §3.5: a quick evaluation never shows the progress bar, a slow one takes it at 200 ms with a
//     fraction — WATCHED until it is, not read at one moment, which failed under load — and opens at
//     the fraction already landed; Cancel stops it between bands and latches the record without a
//     report, and the bar stays up across one content's back-to-back evaluations instead of flashing;
//   * a tile's mip chain is built in the pool, once per image, byte for byte what this thread
//     builds; a tri-planar pattern equals the main thread's `evalTri`, at the band edges of a bake
//     whose rows are unevenly spaced too; a pattern on the sheet repeats a whole tile, turns and
//     offsets; on smoothness, metalness and the paint mask it is grey;
//   * a noise lends its alpha as a mask and a pattern its brightness × alpha, on the sheet and
//     along the model, export waiting for the latter, the mask's sheet let go with its link on the
//     sheet and kept along the model; "noise…" in the Mask row adds a hidden noise
//     under the layer and masks by it in one undo step; save / load keeps both records and the tile,
//     at version 5; a duplicate shares no record, no evaluation in flight and no lent mask; the
//     thumbnails draw them.
//
// Usage: node tools/t94_pattern.mjs [--keep] [--chrome <path>]
import fs from "fs";
import { findBrowser, evalInPage, pageExpr, makeReport, ROOT } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const src = fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8");
const sectionOf = n => {
  const a = src.search(new RegExp("[\\n>]/\\*==" + n + "==\\*/")), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("no " + n + " section in the page");
  return src.slice(a + 1, b).replace(/^"use strict";$/m, "");
};
const { Gradient, Procedural } = new Function(sectionOf("GRADIENT") + "\n" + sectionOf("PROCEDURAL") + "\nreturn { Gradient, Procedural };")();

// a seeded stream of sample points, so every run measures the same ones
let rs = 20260926;
const rnd = () => { rs = (Math.imul(rs, 1664525) + 1013904223) | 0; return (rs >>> 0) / 4294967296; };
const stats = a => { let m = 0; for (const v of a) m += v; m /= a.length; let s = 0; for (const v of a) s += (v - m) * (v - m); return { m, sd: Math.sqrt(s / a.length) }; };
const corr = (a, b) => { const A = stats(a), B = stats(b); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - A.m) * (b[i] - B.m); return s / a.length / (A.sd * B.sd); };
const rec = (o) => Object.assign(Procedural.noiseMake(), o);

// ---- the noise field ----
{
  const k = Procedural.prep(rec({ seed: 11 })), k2 = Procedural.prep(rec({ seed: 11 })), k3 = Procedural.prep(rec({ seed: 12 }));
  const a = [], b = [], c = [];
  for (let i = 0; i < 2000; i++) { const x = rnd() * 40 - 20, y = rnd() * 6, z = rnd() * 16 - 8; a.push(Procedural.at(k, x, y, z)); b.push(Procedural.at(k2, x, y, z)); c.push(Procedural.at(k3, x, y, z)); }
  R.is(a.every((v, i) => v === b[i]), "the same record is the same noise, value for value (integer hashing, no float hash to differ between machines)");
  const cr = corr(a, c);
  R.is(Math.abs(cr) < .15, `…and another seed is another noise (correlation ${cr.toFixed(3)} between seeds 11 and 12)`);
}
{
  const spread = {};
  for (const type of Procedural.NOISE) for (const octaves of [1, 4, 8]) {
    const k = Procedural.prep(rec({ type, octaves, scale: 1, seed: 3 }));
    const v = [];
    for (let i = 0; i < 12000; i++) v.push(Procedural.at(k, rnd() * 300 - 150, rnd() * 300 - 150, rnd() * 300 - 150));
    const s = stats(v), clip = v.filter(x => x <= 0 || x >= 1).length / v.length;
    spread[type + octaves] = s.sd;
    R.is(v.every(x => x >= 0 && x <= 1) && Math.abs(s.m - .5) < .05 && clip < .04,
      `${type}, ${octaves} octave${octaves > 1 ? "s" : ""}: in 0…1, centred (mean ${s.m.toFixed(3)}), ${(clip * 100).toFixed(1)} % clipped`);
  }
  for (const type of Procedural.NOISE) {
    const r = spread[type + 8] / spread[type + 1];
    R.is(r > .85 && r < 1.15, `${type}: eight octaves spread as widely as one (sd ${spread[type + 1].toFixed(3)} → ${spread[type + 8].toFixed(3)}); a fixed divisor gives eight octaves 0.59× the contrast`);
  }
}
{
  // metres: halving the scale is doubling the positions, exactly — and for a streak too
  let same = true;
  for (const type of Procedural.NOISE) {
    const k1 = Procedural.prep(rec({ type, scale: .25, seed: 5 })), k2 = Procedural.prep(rec({ type, scale: .5, seed: 5 }));
    for (let i = 0; i < 300; i++) { const x = rnd() * 20, y = rnd() * 4, z = rnd() * 9; if (Procedural.at(k1, x, y, z) !== Procedural.at(k2, 2 * x, 2 * y, 2 * z)) same = false; }
  }
  R.is(same, "the scale is in metres: the field at scale 2s and position 2p is the field at s and p, bit for bit, for every kind");
  // streaks run along +y (the up axis) and nowhere else; Perlin runs every way alike
  const lag = (type, dx, dy) => {
    const k = Procedural.prep(rec({ type, scale: 1, stretch: 10, seed: 9, octaves: 1 }));
    const a = [], b = [];
    for (let i = 0; i < 6000; i++) { const x = rnd() * 200, y = rnd() * 200, z = rnd() * 200; a.push(Procedural.at(k, x, y, z)); b.push(Procedural.at(k, x + dx, y + dy, z)); }
    return corr(a, b);
  };
  const sx = lag("streaks", .6, 0), sy = lag("streaks", 0, .6), px = lag("perlin", .6, 0), py = lag("perlin", 0, .6);
  R.is(sy > .95 && sx < .7, `streaks are long along the up axis and short across it (60 cm apart: ${sy.toFixed(3)} along y, ${sx.toFixed(3)} along x)`);
  R.is(Math.abs(px - py) < .06, `…while Perlin is the same every way (${px.toFixed(3)} along x, ${py.toFixed(3)} along y)`);
  const n = Procedural.noiseClone({ type: "nope", seed: "x", scale: -3, octaves: 99, rough: 7, stretch: 0 });
  R.is(n.type === "perlin" && n.seed === 0 && n.scale === .001 && n.octaves === 8 && n.rough === 1 && n.stretch === 1, "a noise record is clamped into range whatever it holds");
}

// ---- evalNoise over a synthetic bake ----
// 64 × 16: columns 0–31 and 32–63 hold the SAME positions (two UV islands of one surface), the
// last four rows hold none
const bakeOf = (w, h, fn) => {
  const pos = new Uint16Array(w * h * 3), has = new Uint8Array(w * h), nrm = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, q = fn(x, y);
    if (!q) continue;
    has[i] = 1;
    for (let k = 0; k < 3; k++) { pos[i*3+k] = q.p[k]; nrm[i*3+k] = q.n ? q.n[k] : 128; }
  }
  return { w, h, pos, has, nrm, bb: { x0: -2, y0: -2, z0: -2, x1: 2, y1: 2, z1: 2 } };
};
const u16 = m => Math.round((m + 2) / 4 * 65535);                // metres in the ±2 m box above
{
  const P = bakeOf(64, 16, (x, y) => y < 12 ? { p: [u16((x % 32) * .02), u16(y * .02), u16(.1)] } : null);
  const g = { shape: "noise", space: "model", from: 0, to: 1, repeat: "clamp", noise: rec({ scale: .1, seed: 2 }),
              stops: [{ t: 0, color: "#000000", alpha: 1 }, { t: 1, color: "#ffffff", alpha: 1 }] };
  const whole = new Uint8ClampedArray(64 * 16 * 4);
  Procedural.evalNoise(P, g, 64, 16, 0, 0, 64, 16, whole);
  let seam = 0, lo = 255, hi = 0;
  for (let y = 0; y < 12; y++) for (let x = 0; x < 32; x++) { seam = Math.max(seam, Math.abs(whole[(y * 64 + x) * 4] - whole[(y * 64 + x + 32) * 4])); lo = Math.min(lo, whole[(y * 64 + x) * 4]); hi = Math.max(hi, whole[(y * 64 + x) * 4]); }
  R.is(seam === 0 && hi - lo > 40, `two islands holding the same positions read the same noise, texel for texel (worst difference ${seam}, over a range of ${lo}…${hi})`);
  R.is(whole[(13 * 64 + 5) * 4 + 3] === 0 && whole[(5 * 64 + 5) * 4 + 3] === 255, "a texel with no position is left transparent; one with a position is opaque");
  const reg = new Uint8ClampedArray(20 * 5 * 4);
  Procedural.evalNoise(P, g, 64, 16, 30, 3, 20, 5, reg);
  let rd = 0;
  for (let y = 0; y < 5; y++) for (let x = 0; x < 20; x++) for (let c = 0; c < 4; c++) rd = Math.max(rd, Math.abs(reg[(y * 20 + x) * 4 + c] - whole[((y + 3) * 64 + x + 30) * 4 + c]));
  R.is(rd === 0, `a region reads the same bytes as the whole sheet (worst ${rd})`);
  // a band handed only its own rows of the bake — the worker's contract (GradFill.run)
  const r0 = 5, r1 = 9, band = { w: 64, h: 16, row0: r0, rows: r1 + 1 - r0, bb: P.bb, pos: P.pos.slice(r0 * 64 * 3, (r1 + 1) * 64 * 3), has: P.has.slice(r0 * 64, (r1 + 1) * 64) };
  const bo = new Uint8ClampedArray(64 * (r1 - r0) * 4);
  Procedural.evalNoise(band, g, 64, 16, 0, r0, 64, r1 - r0, bo);
  let bd = 0;
  for (let i = 0; i < bo.length; i++) bd = Math.max(bd, Math.abs(bo[i] - whole[r0 * 64 * 4 + i]));
  R.is(bd === 0, `a band given only rows ${r0}–${r1} of the bake equals the same rows of the whole sheet (worst ${bd})`);
  // levels: From = To is a hard cut — exactly the two stop colours
  const cut = new Uint8ClampedArray(64 * 16 * 4);
  Procedural.evalNoise(P, Object.assign({}, g, { from: .5, to: .5 }), 64, 16, 0, 0, 64, 16, cut);
  const vals = new Set();
  for (let i = 0; i < 64 * 12; i++) vals.add(cut[i * 4]);
  R.is(vals.size === 2 && vals.has(0) && vals.has(255), `From = To cuts the noise to exactly its two end stops (${[...vals].join(", ")})`);
}

// ---- pattern records, the mip chain, the tap ----
{
  const p = Procedural.patClone({ space: "moon", repeat: 0, size: NaN, angle: 900, x: 3, sharp: 0 });
  R.is(p.space === "uv" && p.repeat === 1 && p.size === 1 && p.angle === 360 && p.x === 1 && p.sharp === 1, "a pattern record is clamped into range whatever it holds");
  // a 6 × 3 tile: resampled to 8 × 4, then halved to 1 × 1, each level a 2×2 box of the last
  const img = new Uint8ClampedArray(6 * 3 * 4);
  for (let i = 0; i < 18; i++) { img[i*4] = (i * 37) % 256; img[i*4+1] = (i * 91) % 256; img[i*4+2] = (i * 53) % 256; img[i*4+3] = 255; }
  const M = Procedural.mips(img, 6, 3);
  R.is(M.levels.map(l => l.w + "x" + l.h).join(" ") === "8x4 4x2 2x1 1x1" && Math.abs(M.aspect - .5) < 1e-12,
    `a 6 × 3 tile becomes power-of-two levels ${M.levels.map(l => l.w + "×" + l.h).join(", ")}, keeping the tile's own aspect (${M.aspect})`);
  let box = 0;
  for (let l = 1; l < M.levels.length; l++) {
    const A = M.levels[l - 1], B = M.levels[l], sx = A.w / B.w, sy = A.h / B.h;
    for (let y = 0; y < B.h; y++) for (let x = 0; x < B.w; x++) for (let c = 0; c < 4; c++) {
      let s = 0; for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) s += A.d[((y * sy + j) * A.w + x * sx + i) * 4 + c];
      box = Math.max(box, Math.abs(B.d[(y * B.w + x) * 4 + c] - s / (sx * sy)));
    }
  }
  R.is(box <= .5, `every level is the 2×2 box of the one before (worst ${box})`);
  // what crosses to a worker: one buffer and a table, and back to the same levels
  const U = Procedural.unpack(Procedural.pack(M));
  R.is(U.aspect === M.aspect && U.levels.length === M.levels.length && U.levels.every((l, i) => l.w === M.levels[i].w && l.h === M.levels[i].h && l.d.every((v, j) => v === M.levels[i].d[j])),
    "packed into one buffer for a worker, the chain unpacks to the same levels, byte for byte");
  // premultiplied: white on a keyed-out background shrinks to WHITE at half alpha. The background
  // is transparent RED — a key leaves the colour behind (canvas keeps RGB at any alpha above 0,
  // and a PNG at 0 too) — because transparent BLACK averages the same premultiplied or not, and
  // the first version of this check, on black, passed with the premultiply taken out (2026-09-26).
  const ck = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) {
    if (((i % 4) + (i >> 2)) & 1) { ck[i*4] = ck[i*4+1] = ck[i*4+2] = 255; ck[i*4+3] = 255; }
    else ck[i*4] = 255;                                              // red, alpha 0
  }
  const Mk = Procedural.mips(ck, 4, 4), top = Mk.levels[Mk.levels.length - 1].d;
  R.is(top[3] === 128 && Math.abs(top[0] - top[1]) <= 1 && Math.abs(top[1] - top[2]) <= 1 && Math.abs(top[0] / top[3] * 255 - 255) <= 2,
    `the chain is premultiplied: a tile keyed off a red background shrinks to white at half alpha (${top.slice(0, 4)} premultiplied), not pink`);
  // a tap wraps: a whole tile along is the same sample
  const acc = u => { const a = [0, 0, 0, 0]; Procedural.tap(M.levels[0], u, .3, 1, a); return a.map(v => v.toFixed(6)).join(); };
  R.is(acc(.37) === acc(1.37) && acc(.37) === acc(-2.63), "a tap wraps: the same sample a whole tile along, either way");
  // the UV matrix: `repeat` whole tiles across the sheet, an angle turns them, an offset slides them
  const m = Procedural.uvMatrix({ repeat: 4, angle: 0, x: 0, y: 0 }, 1024, 512, 64, 32);
  const at = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const e = at(m, 64, 32);
  R.is(e[0] === 256 && e[1] === 128, `4 repeats on a 1024-wide sheet: the tile's far corner lands at (${e}), a quarter of the width, its aspect kept`);
  const m90 = Procedural.uvMatrix({ repeat: 4, angle: 90 }, 1024, 512, 64, 32), e90 = at(m90, 64, 0);
  R.is(Math.abs(e90[0]) < 1e-9 && Math.abs(e90[1] - 256) < 1e-9, `at 90° the tile's width runs down the sheet (${e90.map(v => +v.toFixed(6))})`);
  const mo = Procedural.uvMatrix({ repeat: 4, x: .5, y: .25 }, 1024, 512, 64, 32), eo = at(mo, 0, 0);
  R.is(eo[0] === 128 && eo[1] === 32, `an offset of (½, ¼) of a tile slides the pattern (${eo})`);
}

// ---- tri-planar ----
{
  // the tile: four 64-px quadrants, red | green over blue | yellow
  const T = 128, img = new Uint8ClampedArray(T * T * 4);
  const Q = [[220, 30, 30], [30, 200, 40], [40, 60, 220], [230, 210, 30]];
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const q = Q[(y >= 64 ? 2 : 0) + (x >= 64 ? 1 : 0)], o = (y * T + x) * 4; img[o] = q[0]; img[o+1] = q[1]; img[o+2] = q[2]; img[o+3] = 255; }
  const M = Procedural.mips(img, T, T);
  // one texel per case, every neighbour holding the same position: footprint 0, the sharpest level
  const n8 = v => v.map(c => Math.round((c + 1) * 127.5));
  const cases = [
    { name: "+z face at (.25, −.25)", p: [.25, -.25, 0], n: [0, 0, 1], want: 0 },           // u = x, v = −y
    { name: "+z face at (.75, −.25)", p: [.75, -.25, 0], n: [0, 0, 1], want: 1 },
    { name: "+x face at z −.25, y −.75", p: [0, -.75, -.25], n: [1, 0, 0], want: 2 },       // u = −z, v = −y
    { name: "−x face at z .25, y −.75", p: [0, -.75, .25], n: [-1, 0, 0], want: 2 },        // mirrored: u = +z
    { name: "+y face at z .75, x −.75", p: [-.75, 0, .75], n: [0, 1, 0], want: 3 },         // u = z, v = −x
  ];
  const run = (c, sharp, extra) => {
    const P = bakeOf(3, 3, () => ({ p: c.p.map(u16), n: n8(c.n) }));
    const out = new Uint8ClampedArray(9 * 4);
    Procedural.evalTri(P, Object.assign({ space: "model", size: 1, angle: 0, x: 0, y: 0, sharp }, extra || {}), M, 3, 3, 0, 0, 3, 3, out);
    return [out[16], out[17], out[18], out[19]];
  };
  for (const c of cases) {
    const got = run(c, 4), want = Q[c.want];
    R.is(got.slice(0, 3).every((v, i) => Math.abs(v - want[i]) <= 1) && got[3] === 255, `${c.name} shows its own axis's projection: ${got.slice(0, 3)} (want ${want})`);
  }
  // a face halfway between +x and +z, sharpness 1: half of each projection
  const mid = run({ p: [.25, -.75, -.25], n: [Math.SQRT1_2, 0, Math.SQRT1_2] }, 1);
  const zc = Q[0], xc = Q[2];                        // +z at (u .25, v .75)? no — see below
  // +z: u = x = .25, v = −y = .75 → blue (2); +x: u = −z = .25, v = .75 → blue (2): both blue
  R.is(mid.slice(0, 3).every((v, i) => Math.abs(v - xc[i]) <= 1), `a 45° face between +x and +z, both projections landing in blue, is blue (${mid.slice(0, 3)})`);
  const mix = run({ p: [.75, -.75, -.25], n: [Math.SQRT1_2, 0, Math.SQRT1_2] }, 1);   // +z → yellow (x .75, v .75); +x → blue
  const exp = Q[3].map((v, i) => (v + Q[2][i]) / 2);
  R.is(mix.slice(0, 3).every((v, i) => Math.abs(v - exp[i]) <= 2), `…and where the two differ it is their mean, weighed |n|¹ (${mix.slice(0, 3)} against ${exp})`);
  // sharpness 16 at 30° off +z: the x projection weighs .5¹⁶ against .866¹⁶ — under a thousandth, dropped
  const n30 = [.5, 0, Math.sqrt(3) / 2];
  const hard = run({ p: [.75, -.75, -.25], n: n30 }, 16), soft = run({ p: [.75, -.75, -.25], n: n30 }, 1);
  R.is(hard.slice(0, 3).every((v, i) => v === Q[3][i]) && !soft.slice(0, 3).every((v, i) => v === Q[3][i]),
    `a hard blend drops a projection weighing under a thousandth (${hard.slice(0, 3)} is pure yellow; a soft one mixes, ${soft.slice(0, 3)})`);
  void zc;
  // a fine checker shrunk sixteen-fold is filtered to its mean, not aliased: 1-px squares on a
  // 64-px tile 1 m wide, sampled every 25 cm (16 tile pixels a texel)
  const F = 64, fine = new Uint8ClampedArray(F * F * 4);
  for (let i = 0; i < F * F; i++) { const v = ((i % F) + ((i / F) | 0)) & 1 ? 255 : 0; fine[i*4] = fine[i*4+1] = fine[i*4+2] = v; fine[i*4+3] = 255; }
  const MF = Procedural.mips(fine, F, F);
  const P = bakeOf(16, 16, (x, y) => ({ p: [u16(-2 + x * .25 + .013), u16(-2 + y * .25 + .007), u16(0)], n: [128, 128, 255] }));
  const out = new Uint8ClampedArray(16 * 16 * 4);
  Procedural.evalTri(P, { space: "model", size: 1, angle: 0, x: 0, y: 0, sharp: 4 }, MF, 16, 16, 0, 0, 16, 16, out);
  let lo = 255, hi = 0;
  for (let i = 0; i < 256; i++) { lo = Math.min(lo, out[i*4]); hi = Math.max(hi, out[i*4]); }
  R.is(lo >= 120 && hi <= 136, `a 1-px checker shown at 16 tile pixels a texel is filtered to its mean grey (${lo}…${hi}), not aliased to black and white`);
  // A band handed its rows plus the row above and the row below — `GradFill.band`'s contract, since
  // the footprint reads both sides — equals the same rows of the whole. The bake's rows are spaced
  // quadratically, so the step up and the step down differ on every row, and the tile is noise, so
  // every mip level differs from the next: a band missing the row above must read a different
  // level on its first row. (The first version of this check had evenly spaced rows and a tile
  // whose levels were all one grey; a band missing any row passed it.)
  const NT = 64, nt = new Uint8ClampedArray(NT * NT * 4);
  for (let i = 0; i < NT * NT * 4; i++) nt[i] = (i & 3) === 3 ? 255 : (rnd() * 256) | 0;
  const MN = Procedural.mips(nt, NT, NT);
  const PQ = bakeOf(16, 16, (x, y) => ({ p: [u16(-2 + x * .02 + .013), u16(1.5 - y * y * .012), u16(0)], n: [128, 128, 255] }));
  const rec3 = { space: "model", size: .6, angle: 30, x: .1, y: .2, sharp: 3 };
  const whole = new Uint8ClampedArray(16 * 16 * 4);
  Procedural.evalTri(PQ, rec3, MN, 16, 16, 0, 0, 16, 16, whole);
  const bandOf = (h0, r0, r1) => {
    const b = { w: 16, h: 16, row0: h0, rows: r1 + 1 - h0, bb: PQ.bb, pos: PQ.pos.slice(h0 * 48, (r1 + 1) * 48), has: PQ.has.slice(h0 * 16, (r1 + 1) * 16), nrm: PQ.nrm.slice(h0 * 48, (r1 + 1) * 48) };
    const bo = new Uint8ClampedArray(16 * (r1 - r0) * 4);
    Procedural.evalTri(b, rec3, MN, 16, 16, 0, r0, 16, r1 - r0, bo);
    let bd = 0;
    for (let i = 0; i < bo.length; i++) bd = Math.max(bd, Math.abs(bo[i] - whole[r0 * 64 + i]));
    return bd;
  };
  const bd = bandOf(5, 6, 11), bdBelowOnly = bandOf(6, 6, 11);
  R.is(bd === 0 && bdBelowOnly > 0, `a tri-planar band given its rows and the rows above and below equals the whole sheet's (worst ${bd}; given only the row below, its first row reads another level — worst ${bdBelowOnly})`);
}

// ---- tri-planar turns and slides the way the sheet does ----
// A +z face is the sheet's own frame — u = x, v = −y, right and down as it is seen — so along the
// model it must show, texel for texel, what the sheet shows at the same point, the sheet's mapping
// read back through `uvMatrix` itself. The first version turned the other way and slid the other
// way, and nothing here saw it: every tri-planar check ran at angle 0 and offset 0 (review of
// 4.50 (7), 2026-09-26 — a mutant ignoring the angle, and one ignoring the offsets, passed 87/87).
{
  const T = 64, img = new Uint8ClampedArray(T * T * 4);
  const Q = [[220, 30, 30], [30, 200, 40], [40, 60, 220], [230, 210, 30]];
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const q = Q[(y >= 32 ? 2 : 0) + (x >= 32 ? 1 : 0)], o = (y * T + x) * 4; img[o] = q[0]; img[o+1] = q[1]; img[o+2] = q[2]; img[o+3] = 255; }
  const M = Procedural.mips(img, T, T);
  const W = 128, REP = 2, d = REP / W;                      // a tile 1 m wide is W / REP texels
  const P = bakeOf(W, W, (i, j) => ({ p: [u16((i + .5) * d), u16(-(j + .5) * d), u16(0)], n: [128, 128, 255] }));
  for (const [ang, ox, oy] of [[0, 0, 0], [30, 0, 0], [90, 0, 0], [0, .25, 0], [0, 0, .25], [200, .1, .3], [-45, -.2, .35]]) {
    const pat = { space: "model", size: 1, angle: ang, x: ox, y: oy, sharp: 4, repeat: REP };
    const out = new Uint8ClampedArray(W * W * 4);
    Procedural.evalTri(P, pat, M, W, W, 0, 0, W, W, out);
    const m = Procedural.uvMatrix(pat, W, W, T, T), det = m[0] * m[3] - m[1] * m[2];
    let n = 0, bad = 0;
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      // the sheet's tile coordinate at this texel's centre, through the inverse of the sheet's matrix
      const sx = i + .5 - m[4], sy = j + .5 - m[5];
      const tu = (((m[3] * sx - m[2] * sy) / det / T) % 1 + 1) % 1, tv = (((-m[1] * sx + m[0] * sy) / det / T) % 1 + 1) % 1;
      if ([tu, tv].some(t => Math.min(t, Math.abs(t - .5), 1 - t) < .04)) continue;    // clear of the quadrants' edges
      const want = Q[(tv >= .5 ? 2 : 0) + (tu >= .5 ? 1 : 0)], o = (j * W + i) * 4;
      n++;
      if (want.some((v, c) => Math.abs(out[o + c] - v) > 3)) bad++;
    }
    R.is(bad === 0 && n > 8000, `a +z face along the model at ${ang}°, offset (${ox}, ${oy}), shows what the sheet shows at the same point (${bad} of ${n} texels differ)`);
  }
}

// ---- the rim of an island whose UVs touch another's ----
// Four 32² islands in one 64² bake, touching along its middle lines, each 5 m from the others on the
// vehicle. The footprint's step across the seam is then 5 m; the first version took it, and the rim
// read the tile's 1×1 mean — a purple line down a red / blue stripe tile (review of 4.50 (7),
// 2026-09-26, 196 of 196 rim texels). Every texel must be its own stripe's colour, rim or not.
{
  const T = 64, st = new Uint8ClampedArray(T * T * 4);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const o = (y * T + x) * 4, red = ((x >> 3) & 1) === 0; st[o] = red ? 255 : 0; st[o+2] = red ? 0 : 255; st[o+3] = 255; }
  const MS = Procedural.mips(st, T, T), W = 64, d = 1 / 64, bb = { x0: -1, y0: -7, z0: -1, x1: 7, y1: 1, z1: 1 };
  const q16 = (m, a0, a1) => Math.round((m - a0) / (a1 - a0) * 65535);
  const P = bakeOf(W, W, (i, j) => ({ p: [q16(5 * (i >> 5) + ((i & 31) + .5) * d, bb.x0, bb.x1), q16(-5 * (j >> 5) - ((j & 31) + .5) * d, bb.y0, bb.y1), q16(0, bb.z0, bb.z1)], n: [128, 128, 255] }));
  P.bb = bb;
  const out = new Uint8ClampedArray(W * W * 4);
  Procedural.evalTri(P, { space: "model", size: 1, angle: 0, x: 0, y: 0, sharp: 4 }, MS, W, W, 0, 0, W, W, out);
  let wrong = 0, rimWrong = 0;
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const red = (((i & 31) >> 3) & 1) === 0, o = (j * W + i) * 4;
    const ok = red ? out[o] >= 200 && out[o+2] <= 55 : out[o+2] >= 200 && out[o] <= 55;
    if (!ok) { wrong++; if ((i & 31) === 31 || (j & 31) === 31 || (i & 31) === 0 || (j & 31) === 0) rimWrong++; }
  }
  R.is(wrong === 0, `islands whose UVs touch but sit 5 m apart keep their own stripes to the rim (${wrong} texels off their stripe, ${rimWrong} of them on a rim)`);
}

// ---- where a pattern on the sheet meets itself ----
// A whole number of repeats meets itself across the sheet's left and right edges at 0° and 180°,
// whatever the tile's aspect and offset, and across the top and bottom when the tile's height goes
// into the sheet's (a square tile on a square sheet). That is all the Repeats tooltip claims now;
// the first version claimed every edge at every angle (review of 4.50 (7), 2026-09-26).
{
  const whole = v => Math.abs(v - Math.round(v)) < 1e-9;
  const across = (pat, W, H, iw, ih, dx, dy) => {
    const m = Procedural.uvMatrix(pat, W, H, iw, ih), det = m[0] * m[3] - m[1] * m[2];
    return [(m[3] * dx - m[2] * dy) / det / iw, (-m[1] * dx + m[0] * dy) / det / ih];   // in tiles
  };
  const lr = [0, 180].every(a => across({ repeat: 4, angle: a, x: .3, y: .7 }, 256, 256, 64, 48, 256, 0).every(whole));
  const tb = across({ repeat: 4, angle: 0, x: .3, y: .7 }, 256, 256, 64, 64, 0, 256).every(whole);
  R.is(lr && tb, "a whole number of repeats meets itself across the sheet's left and right edges at 0° and 180° (a 64 × 48 tile, offset), and across the top and bottom with a square tile on a square sheet");
}

// ---- the real page ----
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { R.finish("SKIP: no Chrome or Edge found for the page half. Pass --chrome <path> or set CHROME."); }

const BODY = `async function(){
  var out = {}, N = 256;
  var px = function(c, x, y){ var d = ctx2d(c).getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
  var grey = function(){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = "#808080"; g.fillRect(0, 0, N, N); return c; };
  var s = { id: "t94", size: N, nSize: N, layers: [], missing: false, baseC: grey(), composite: grey(), normal: null, smooth: grey(), metal: grey() };
  App.slots.set("t94", s);
  var was = App.activeSlot; App.activeSlot = s;
  var flush = function(){ compositeSlot(s); flushComposites(); };
  var wait = async function(c, L){ await GradFill.settle(s, c, L); flushComposites(); };
  // four quads facing +y on four bands of the sheet — q2 at the SAME place as q0, so two islands
  // hold one surface of the vehicle
  var BANDS = 4;
  function quad(name, x, band){
    var idx = [0, 1, 2, 0, 2, 3], corners = [[x, 0, -1], [x + .5, 0, -1], [x + .5, 0, 1], [x, 0, 1]], uvc = [[0, 0], [1, 0], [1, 1], [0, 1]];
    var pos = new Float32Array(18), nor = new Float32Array(18), uv = new Float32Array(12);
    for (var k = 0; k < 6; k++) {
      var c = corners[idx[k]], t = uvc[idx[k]];
      pos[k*3] = c[0]; pos[k*3+1] = c[1]; pos[k*3+2] = c[2];
      nor[k*3] = 0; nor[k*3+1] = 1; nor[k*3+2] = 0;
      uv[k*2] = (band + t[0] * .8 + .1) / BANDS; uv[k*2+1] = t[1] * .8 + .1;
    }
    return { name: name, mat: "testmat", position: pos, normal: nor, uv: uv };
  }
  var all = [quad("q0", 0, 0), quad("q1", 1, 1), quad("q2", 0, 2), quad("q3", 3, 3)];
  var meshes = new Map(); all.forEach(function(g){ meshes.set(g.name, { visible: true }); });
  App.geomData = all; App.meshes = meshes; App.matSlot = new Map([["testmat", "t94"]]);
  App.protectedParts = new Set(); App.selParts = new Set(); App._projGL = null;
  if (!projGL()) { out.mode = "none"; App.activeSlot = was; App.slots.delete("t94"); return out; }
  out.mode = "gl";

  // ---- 1. the bake carries normals, padded and packed in the bake pool ----
  // The planes are copied on their way to the worker, and this thread's own packPositions of the
  // copies must be the bake, byte for byte: the padding held the UI thread 357-412 ms at 2048²
  // before it moved (review of 4.50 (7), 2026-09-26).
  var sent = null, bpool = Bake.workers(), origBC = bpool.call;
  bpool.call = function(op, a, xfer){
    if (op === "posPack") sent = { p0: new Uint8ClampedArray(a.p0.slice(0)), p1: new Uint8ClampedArray(a.p1.slice(0)), p2: new Uint8ClampedArray(a.p2.slice(0)), w: a.w, h: a.h, pad: a.pad };
    return origBC(op, a, xfer);
  };
  var pb = await Bake.run(s, "pos");
  bpool.call = origBC;
  var ci = Math.round(.5 * pb.h) * pb.w + Math.round(1.5 * pb.w / BANDS);
  out.nrm = pb.nrm ? [pb.nrm[ci*3], pb.nrm[ci*3+1], pb.nrm[ci*3+2]] : null;
  out.posPack = { sent: !!sent, mode: bpool.mode, worst: -1, padded: 0 };
  if (sent) {
    var mine = BakeMesh.packPositions(sent.p0, sent.p1, sent.p2, sent.w, sent.h, sent.pad), pw = 0;
    ["pos", "has", "nrm", "cov"].forEach(function(k){ var A = mine[k], B = pb[k]; if (!B || A.length !== B.length) { pw = 999; return; } for (var q = 0; q < A.length; q++) if (A[q] !== B[q]) pw = Math.max(pw, Math.abs(A[q] - B[q])); });
    // ...and every texel that holds a position holds a normal: the normal plane is padded over the
    // same coverage as the positions, so no gutter texel reads (0, 0, 0) — three equal projections
    var pad0 = 0, bare = 0;
    for (var q1 = 0; q1 < pb.has.length; q1++) {
      if (!pb.has[q1]) continue;
      if (!pb.cov[q1]) pad0++;
      var ex = pb.nrm[q1*3] / 127.5 - 1, ey = pb.nrm[q1*3+1] / 127.5 - 1, ez = pb.nrm[q1*3+2] / 127.5 - 1;
      if (Math.abs(ex * ex + ey * ey + ez * ez - 1) > .05) bare++;
    }
    out.posPack.worst = pw; out.posPack.padded = pad0; out.posPack.bare = bare;
  }

  // ---- 2. a noise fill, through the pool ----
  var bw = [{ t: 0, color: "#000000", alpha: 1 }, { t: 1, color: "#ffffff", alpha: 1 }];
  var L = LayerNode.of({ type: "fill", name: "grime", color: "#000000", visible: true, opacity: 1, blend: "normal",
    grad: { shape: "noise", space: "model", angle: 0, dir: [1, 0, 0], from: 0, to: 1, repeat: "clamp", stops: bw, noise: { type: "perlin", seed: 4, scale: .15, octaves: 4, rough: .5, stretch: 8 } } });
  s.layers = [L]; App.activeLayer = L;
  var c = LayerNode.contentOn(L, "color");
  var t0 = performance.now();
  var first = GradFill.sheet({ slot: s, ch: "color", W: N, H: N, sx: 0, sy: 0, tw: N, th: N }, c, L);
  out.async = { first: first, ms: performance.now() - t0, busy: !!(c._proc && c._proc.busy) };
  await wait(c, L);
  out.poolMode = GradFill._pool && GradFill._pool.mode;
  var sh = c._gradSheet;
  out.sheetSize = sh ? [sh.width, sh.height] : null;
  // the oracle: the main thread's own evaluation of the same bake
  var P = Bake.cached(s, "pos");
  var ora = new Uint8ClampedArray(P.w * P.h * 4);
  Procedural.evalNoise(P, Gradient.clone(c.grad), P.w, P.h, 0, 0, P.w, P.h, ora);
  var got = ctx2d(sh).getImageData(0, 0, P.w, P.h).data, worst = 0, covered = 0;
  for (var i = 0; i < P.w * P.h; i++) { if (ora[i*4+3] === 255) covered++; for (var k2 = 0; k2 < 4; k2++) worst = Math.max(worst, Math.abs(got[i*4+k2] - ora[i*4+k2])); }
  out.oracle = { worst: worst, covered: covered };
  // q0 (band 0) and q2 (band 2) are one surface: the same noise, texel for texel, inside the quads
  var seam = 0, lo = 255, hi = 0;
  for (var y = 40; y < 216; y++) for (var x = 10; x < 54; x++) {
    var a = got[(y * P.w + x) * 4], b = got[(y * P.w + x + 128) * 4];
    seam = Math.max(seam, Math.abs(a - b)); lo = Math.min(lo, a); hi = Math.max(hi, a);
  }
  out.islands = { seam: seam, lo: lo, hi: hi, q1: got[(128 * P.w + 96) * 4] };
  flush();
  out.composite = { at: px(s.composite, 32, 128), sheet: [got[(128 * P.w + 32) * 4], got[(128 * P.w + 32) * 4 + 1]], gutter: px(s.composite, 2, 2) };

  // ---- 3. while a new record is worked on, the last sheet stays; one evaluation per content ----
  var before = c._gradSheet, runs = 0, origRun = GradFill.run;
  GradFill.run = function(job){ runs++; return origRun.call(GradFill, job); };
  for (var sd = 10; sd < 15; sd++) {
    L.grad = Object.assign(Gradient.clone(L.grad), { noise: Object.assign({}, L.grad.noise, { seed: sd }) });
    var shown = GradFill.sheet({ slot: s, ch: "color", W: N, H: N, sx: 0, sy: 0, tw: N, th: N }, c, L);
    if (sd === 10) out.stale = { same: shown === before, busy: !!(c._proc && c._proc.busy) };
  }
  out.inflight = runs;
  await wait(c, L);
  GradFill.run = origRun;
  var job = GradFill.job(s, c, L);
  out.latest = { key: c._gradKey === job.key, runs: runs, moved: c._gradSheet !== before };

  // ---- 4. a failure is reported once and latched ----
  var reports = [], origReport = reportFailure;
  reportFailure = function(what){ reports.push(what); };
  GradFill.run = function(){ return Promise.reject(new Error("the worker fell over")); };
  L.grad = Object.assign(Gradient.clone(L.grad), { noise: Object.assign({}, L.grad.noise, { seed: 99 }) });
  flush();
  await new Promise(function(r){ setTimeout(r, 60); });
  flush(); flush();
  await new Promise(function(r){ setTimeout(r, 60); });
  var threw = false;
  try { await GradFill.settle(s, c, L); } catch (e) { threw = /could not be evaluated/.test(e.message); }
  out.latch = { reports: reports.length, fail: !!(c._proc && c._proc.fail), settleThrows: threw };
  GradFill.run = origRun; reportFailure = origReport;

  // ---- 5. export waits for the current record ----
  L.grad = Object.assign(Gradient.clone(L.grad), { noise: Object.assign({}, L.grad.noise, { seed: 7 }) });
  await GradFill.ensure();
  out.ensure = GradFill.job(s, c, L).key === c._gradKey;
  out.unlatched = !c._proc.fail;                     // a record that lands lifts the failed one's latch

  // ---- 5b. the progress bar (§3.5): not for a quick evaluation; for a slow one, by bands, cancellable ----
  await new Promise(function(r){ setTimeout(r, 300); });
  out.quickNoBar = !Prog.active;                     // every evaluation above took a few ms: the bar never came up
  // a slow one of our own: cells at eight octaves over a 2048² bake, every texel covered — over a
  // second of work at eight workers (measured 647 ms at 60 % covered)
  var S2 = 2048, pos2 = new Uint16Array(S2 * S2 * 3), has2 = new Uint8Array(S2 * S2).fill(1);
  for (var i2 = 0; i2 < S2 * S2; i2++) { pos2[i2*3] = (i2 % S2) * 32; pos2[i2*3+1] = ((i2 / S2) | 0) * 32; pos2[i2*3+2] = 7777; }
  var P2 = { w: S2, h: S2, pos: pos2, has: has2, nrm: null, bb: { x0: -10, y0: -10, z0: -10, x1: 10, y1: 10, z1: 10 }, key: "big", ser: 1 };
  var slow = { kind: "noise", P: P2, key: "slow", rec: Object.assign(Gradient.clone(L.grad), { noise: { type: "cells", seed: 3, scale: .05, octaves: 8, rough: .7, stretch: 8 } }) };
  // WATCHED, not looked at once: the first version read the bar at a fixed 450 ms, and under load —
  // two suites at once — the first band can land after any fixed moment, so it failed once as
  // "-100 % at 450 ms" and passed on the re-run (review of 4.50 (7), 2026-09-26). Now: when did the
  // bar come up, and was it labelled and determinate while the evaluation still ran.
  var t2 = performance.now(), st2 = {}, bar = GradFill.barFor(st2, "Working out a test noise…"), ticks = 0, tick0 = bar.tick;
  bar.tick = function(d, t){ ticks = d; out.bands = t; tick0(d, t); };
  var res = null, upAt = -1, seen = null;
  GradFill.run(slow, bar).then(function(){ res = "landed"; }, function(e){ res = e; });
  while (res === null && performance.now() - t2 < 30000) {
    var oursNow = Prog.active && Prog.gen === st2.bar.gen;
    if (oursNow && upAt < 0) upAt = performance.now() - t2;
    if (oursNow && Prog.frac >= 0) { seen = { label: Prog.label, frac: Prog.frac, at: performance.now() - t2 }; break; }
    await new Promise(function(r){ setTimeout(r, 5); });
  }
  out.bar = { upAt: upAt, seen: seen, running: res === null };
  $("progCancel").onclick();
  // A deadline of its own (the 2026-10-22 scan's (6)): a regression where Cancel never lands used to
  // spin here until the whole suite was killed. Now it is this check failing, in words, after 20 s.
  var tc = performance.now();
  while (res === null && performance.now() - tc < 20000) await new Promise(function(r){ setTimeout(r, 10); });
  out.cancel = { cancelled: res instanceof Cancelled, landed: ticks, hung: res === null };
  bar.end();
  out.cancel.closed = !Prog.active;
  // the bar belongs to the content: the next evaluation inside 250 ms keeps it, and it goes after
  var st3 = {}, b1 = GradFill.barFor(st3, "one…");
  await new Promise(function(r){ setTimeout(r, 260); });
  var g1 = Prog.active && Prog.gen === st3.bar.gen ? Prog.gen : -1;
  b1.end();
  var b2 = GradFill.barFor(st3, "two…"), kept = Prog.active && Prog.gen === g1 && Prog.label === "two…";
  b2.end();
  await new Promise(function(r){ setTimeout(r, 300); });
  out.sticky = { up: g1 >= 0, kept: kept, closed: !Prog.active };
  // bands that land before the bar comes up count: it opens at their fraction, not indeterminate
  var st4 = {}, b4 = GradFill.barFor(st4, "three of eight…");
  b4.tick(3, 8);
  await new Promise(function(r){ setTimeout(r, 260); });
  out.opensAt = { up: Prog.active && Prog.gen === st4.bar.gen, frac: Prog.frac };
  b4.end();
  await new Promise(function(r){ setTimeout(r, 300); });
  out.opensAt.closed = !Prog.active;
  // a cancelled record is latched like a failure but not reported; the layer keeps its sheet; an
  // export or convert waiting on it is told it was cancelled
  var reports2 = [], origReport2 = reportFailure, kept2 = c._gradSheet;
  reportFailure = function(w){ reports2.push(w); };
  GradFill.run = function(){ return Promise.reject(new Cancelled()); };
  L.grad = Object.assign(Gradient.clone(L.grad), { noise: Object.assign({}, L.grad.noise, { seed: 55 }) });
  var thrown = null;
  try { await GradFill.settle(s, c, L); } catch (e) { thrown = e; }
  out.cancelLatch = { reports: reports2.length, why: c._proc.why, sheet: c._gradSheet === kept2, settle: thrown instanceof Cancelled };
  GradFill.run = origRun; reportFailure = origReport2;
  // an export asked for AFTER the cancel is a new request: it works the same record out, not refuses it
  var again = null;
  try { await GradFill.settle(s, c, L); } catch (e) { again = e; }
  out.exportAfterCancel = !again && GradFill.job(s, c, L).key === c._gradKey;
  // ...and going to another record and back works it out again
  L.grad = Object.assign(Gradient.clone(L.grad), { noise: Object.assign({}, L.grad.noise, { seed: 56 }) });
  await wait(c, L);
  L.grad = Object.assign(Gradient.clone(L.grad), { noise: Object.assign({}, L.grad.noise, { seed: 55 }) });
  await wait(c, L);
  out.retried = GradFill.job(s, c, L).key === c._gradKey;

  // ---- 6. a noise lends its alpha as a mask; "noise…" builds one ----
  var red = mkCanvas(N, N); ctx2d(red).fillStyle = "#ff0000"; ctx2d(red).fillRect(0, 0, N, N);
  var paint = LayerNode.of({ type: "paint", name: "chips", canvas: red, visible: true, opacity: 1, blend: "normal" });
  L.grad = Object.assign(Gradient.clone(L.grad), { stops: [{ t: 0, color: "#ffffff", alpha: 0 }, { t: 1, color: "#ffffff", alpha: 1 }] });
  L.visible = false; paint.maskRef = L.uid;
  s.layers = [L, paint];
  await wait(c, L); flush();
  var ms = ctx2d(c._gradSheet).getImageData(0, 0, N, N).data, mk = 0;
  for (var yy = 60; yy < 200; yy += 7) for (var xx = 12; xx < 52; xx += 5) {
    var al = ms[(yy * N + xx) * 4 + 3] / 255, want = 128 + (255 - 128) * al, have = px(s.composite, xx, yy)[0];
    mk = Math.max(mk, Math.abs(have - want));
  }
  out.mask = { worst: mk, src: !!LayerNode.maskSource(s, paint), listed: LayerNode.maskSources(s, paint).indexOf(L) >= 0 };
  // chipped paint, the guide's recipe: the noise IS the chip layer, its alpha from its stops, and a
  // mask on it — painted here; the curvature bake is a painted mask too — keeps the chips where the
  // mask shows. Each cuts the other: red over grey at noise alpha × mask alpha, texel by texel. The
  // mask is an ALPHA ramp (wt-canvas: an opaque grey mask hides nothing, and proves nothing).
  var ramp = mkCanvas(N, N), rg = ctx2d(ramp), gr = rg.createLinearGradient(0, 0, 64, 0);
  gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(1, "rgba(255,255,255,1)");
  rg.fillStyle = gr; rg.fillRect(0, 0, N, N);
  L.grad = Object.assign(Gradient.clone(L.grad), { stops: [{ t: 0, color: "#ff0000", alpha: 0 }, { t: 1, color: "#ff0000", alpha: 1 }] });
  L.visible = true; L.mask = ramp; paint.maskRef = null;
  s.layers = [L];
  await wait(c, L); flush();
  var ns = ctx2d(c._gradSheet).getImageData(0, 0, N, N).data, md = ctx2d(ramp).getImageData(0, 0, N, N).data, chip = 0, seen = 0;
  for (var y3 = 60; y3 < 200; y3 += 7) for (var x3 = 2; x3 < 62; x3 += 3) {
    var a3 = ns[(y3 * N + x3) * 4 + 3] / 255 * md[(y3 * N + x3) * 4 + 3] / 255, p3 = px(s.composite, x3, y3);
    if (a3 > .3) seen++;
    chip = Math.max(chip, Math.abs(p3[0] - (128 + 127 * a3)), Math.abs(p3[1] - 128 * (1 - a3)));
  }
  out.chips = { worst: chip, seen: seen };
  L.mask = null;
  paint.maskRef = null; s.layers = [paint]; L.visible = true;
  var undoN = App.undoStack.length;
  GradUI.noiseMask(s, paint);
  var nm = s.layers[0];
  out.noiseMask = { below: s.layers.length === 2 && s.layers[1] === paint && nm !== paint, hidden: nm.visible === false,
                    noise: !!(nm.grad && nm.grad.shape === "noise"), ref: paint.maskRef === nm.uid, steps: App.undoStack.length - undoN };
  doUndo();
  out.noiseMaskUndo = { gone: s.layers.length === 1 && s.layers[0] === paint, ref: !paint.maskRef };

  // ---- 7. convert to paint keeps the pixels ----
  L.grad = Object.assign(Gradient.clone(L.grad), { stops: bw, noise: Object.assign({}, L.grad.noise, { seed: 21 }) });
  s.layers = [L]; App.activeLayer = L;
  flush();                                           // kicks the new record: not ready, so convert goes round render
  var pre = null;
  ChanStrip.convert(s, L, "color", "paint");
  for (var n2 = 0; n2 < 200 && LayerNode.contentOn(L, "color").kind !== "paint"; n2++) await new Promise(function(r){ setTimeout(r, 25); });
  flush();
  var job21 = { key: c._gradKey }, conv = LayerNode.contentOn(L, "color");
  out.convert = { kind: conv.kind, same: conv.kind === "paint" ? (function(){ var A = ctx2d(conv.canvas).getImageData(0, 0, N, N).data, B = ctx2d(c._gradSheet).getImageData(0, 0, N, N).data, w = 0; for (var q = 0; q < A.length; q++) w = Math.max(w, Math.abs(A[q] - B[q])); return w; })() : -1 };
  void pre; void job21;
  doUndo(); flush();
  out.convertUndo = LayerNode.contentOn(L, "color") === c;

  // ---- 8. a pattern along the model, through the pool ----
  var T = 64, tile = mkCanvas(T, T), tg = ctx2d(tile);
  var Q = ["#dc1e1e", "#1ec828", "#283cdc", "#e6d21e"];
  tg.fillStyle = Q[0]; tg.fillRect(0, 0, 32, 32); tg.fillStyle = Q[1]; tg.fillRect(32, 0, 32, 32);
  tg.fillStyle = Q[2]; tg.fillRect(0, 32, 32, 32); tg.fillStyle = Q[3]; tg.fillRect(32, 32, 32, 32);
  var Lp = LayerNode.of({ type: "fill", name: "camo", color: "#808080", visible: true, opacity: 1, blend: "normal",
    pat: { space: "model", repeat: 8, size: .4, angle: 15, x: .1, y: 0, sharp: 4 }, patImg: tile, patName: "quads.png" });
  s.layers = [Lp]; App.activeLayer = Lp;
  var cp = LayerNode.contentOn(Lp, "color");
  flush();
  await wait(cp, Lp);
  // the oracle's mip chain is built HERE, on this thread; the evaluation's came from the pool
  var tc = toCanvas(cp.patImg), Mp = Procedural.mips(ctx2d(tc).getImageData(0, 0, tc.width, tc.height).data, tc.width, tc.height);
  var Mw = Procedural.unpack(await GradFill.mipsFor(cp.patImg)), mw = Mw.levels.length === Mp.levels.length ? 0 : 999;
  for (var lv = 0; lv < Mp.levels.length && !mw; lv++) for (var q2 = 0; q2 < Mp.levels[lv].d.length; q2++) mw = Math.max(mw, Math.abs(Mp.levels[lv].d[q2] - Mw.levels[lv].d[q2]));
  out.mips = { worst: mw, once: GradFill.mipsFor(cp.patImg) === GradFill.mipsFor(cp.patImg), mode: GradFill._pool.mode };
  var orat = new Uint8ClampedArray(P.w * P.h * 4);
  Procedural.evalTri(P, Procedural.patClone(cp.pat), Mp, P.w, P.h, 0, 0, P.w, P.h, orat);
  var gt = ctx2d(cp._gradSheet).getImageData(0, 0, P.w, P.h).data, wt = 0, colours = new Set();
  for (var j = 0; j < P.w * P.h; j++) { if (orat[j*4+3] !== 255) continue; for (var k3 = 0; k3 < 4; k3++) wt = Math.max(wt, Math.abs(gt[j*4+k3] - orat[j*4+k3])); colours.add(gt[j*4] + "," + gt[j*4+1]); }
  out.tri = { worst: wt, kinds: colours.size, key: GradFill.job(s, cp, Lp).key === cp._gradKey };
  // the workers keep the tile they were handed; one that was never handed THIS tile asks for it.
  // Tell the pool it already holds a new, mirrored tile — so no band carries it — and the result
  // must still be that tile's, byte for byte.
  var tile2 = mkCanvas(T, T), t2g = ctx2d(tile2);
  t2g.translate(T, 0); t2g.scale(-1, 1); t2g.drawImage(tile, 0, 0);
  cp.patImg = tile2; GradFill._tileIn = GradFill.imgId(tile2);
  var calls = 0, origCall = GradFill._pool.call;
  GradFill._pool.call = function(op, args, xfer){ if (op === "fill") calls++; return origCall(op, args, xfer); };
  flush();
  await wait(cp, Lp);
  GradFill._pool.call = origCall;
  var M2 = Procedural.mips(ctx2d(tile2).getImageData(0, 0, T, T).data, T, T), ora2 = new Uint8ClampedArray(P.w * P.h * 4);
  Procedural.evalTri(P, Procedural.patClone(cp.pat), M2, P.w, P.h, 0, 0, P.w, P.h, ora2);
  var gt2 = ctx2d(cp._gradSheet).getImageData(0, 0, P.w, P.h).data, wt2 = 0;
  for (var j2 = 0; j2 < P.w * P.h; j2++) { if (ora2[j2*4+3] !== 255) continue; for (var k4 = 0; k4 < 4; k4++) wt2 = Math.max(wt2, Math.abs(gt2[j2*4+k4] - ora2[j2*4+k4])); }
  out.tileAsk = { worst: wt2, calls: calls, bands: Math.min(GradFill._pool.size * 2, Math.floor(P.h / 32)), differs: gt2[(128 * P.w + 20) * 4] !== gt[(128 * P.w + 20) * 4] || gt2[(60 * P.w + 20) * 4] !== gt[(60 * P.w + 20) * 4] };
  flush();                                           // a whole composite prunes — but a pattern along the model is still here
  out.tilesKept = GradFill._tileIn === GradFill.imgId(tile2) && GradFill._pool.mode === "worker";
  cp.patImg = tile;
  // the bands' edges: a pattern's footprint reads the rows above and below, so GradFill.band hands
  // a band both. Over a bake whose rows are spaced quadratically the step up and the step down
  // differ on every row, and the tile is noise, so a band missing either reads another mip level on
  // its edge row than the whole sheet does. (t74's quads are evenly spaced: they could not tell.)
  var S3 = 256, pos3 = new Uint16Array(S3 * S3 * 3), has3 = new Uint8Array(S3 * S3).fill(1), nrm3 = new Uint8Array(S3 * S3 * 3);
  for (var i3 = 0; i3 < S3 * S3; i3++) { var x3 = i3 % S3, y3 = (i3 / S3) | 0; pos3[i3*3] = x3 * 40; pos3[i3*3+1] = Math.round(y3 * y3 * .9); pos3[i3*3+2] = 30000; nrm3[i3*3] = 128; nrm3[i3*3+1] = 128; nrm3[i3*3+2] = 255; }
  var P3 = { w: S3, h: S3, pos: pos3, has: has3, nrm: nrm3, bb: { x0: -2, y0: -2, z0: -2, x1: 2, y1: 2, z1: 2 }, key: "rows", ser: 1 };
  var nz = mkCanvas(64, 64), nzd = ctx2d(nz).createImageData(64, 64);
  for (var q5 = 0; q5 < nzd.data.length; q5++) nzd.data[q5] = (q5 & 3) === 3 ? 255 : (Math.imul(q5 + 1, 2654435761) >>> 24);
  ctx2d(nz).putImageData(nzd, 0, 0);
  var rec5 = Procedural.patClone({ space: "model", size: .3, angle: 20, x: .1, y: .3, sharp: 4 });
  var cv5 = await GradFill.run({ kind: "tri", P: P3, rec: rec5, img: nz, key: "rows" }, null);
  var M5 = Procedural.mips(ctx2d(nz).getImageData(0, 0, 64, 64).data, 64, 64), ora5 = new Uint8ClampedArray(S3 * S3 * 4);
  Procedural.evalTri(P3, rec5, M5, S3, S3, 0, 0, S3, S3, ora5);
  var g5 = ctx2d(cv5).getImageData(0, 0, S3, S3).data, w5 = 0;
  for (var j5 = 0; j5 < g5.length; j5++) w5 = Math.max(w5, Math.abs(g5[j5] - ora5[j5]));
  out.bandEdges = { worst: w5, bands: Math.min(GradFill._pool.size * 2, Math.floor(S3 / 32)) };

  // ---- 9. a pattern on the sheet: whole tiles, an angle, an offset; grey on a single-value map ----
  cp.pat = { space: "uv", repeat: 4, size: 1, angle: 0, x: 0, y: 0, sharp: 4 };
  flush();
  var per = 0;
  for (var y2 = 5; y2 < 250; y2 += 9) for (var x2 = 3; x2 < 190; x2 += 7) { var A1 = px(s.composite, x2, y2), B1 = px(s.composite, x2 + 64, y2); per = Math.max(per, Math.abs(A1[0] - B1[0]), Math.abs(A1[2] - B1[2])); }
  out.uv = { per: per, tl: px(s.composite, 10, 10), tr: px(s.composite, 50, 10), bl: px(s.composite, 10, 50) };
  cp.pat = Object.assign({}, cp.pat, { angle: 90 });
  flush();
  out.uv90 = { tl: px(s.composite, 10, 10), tr: px(s.composite, 50, 10) };
  cp.pat = Object.assign({}, cp.pat, { angle: 0, x: .5 });
  flush();
  out.uvOff = px(s.composite, 10, 10);
  // on each single-value channel — smoothness, metalness and the paint mask — its luminance
  out.grey = {};
  ["smooth", "metal", "wear"].forEach(function(ch){
    var Ls = LayerNode.of({ type: "fill", name: "value pattern", chan: ch, color: "#808080", visible: true, opacity: 1, blend: "normal",
      pat: { space: "uv", repeat: 4, size: 1, angle: 0, x: 0, y: 0, sharp: 4 }, patImg: tile, patName: "quads.png" });
    s.layers = [Ls];
    Composite.sheet(s, ch);                         // the sheet alone — its 3-D texture needs meshes this scene does not have
    out.grey[ch] = s.chanC && s.chanC[ch] ? px(s.chanC[ch], 10, 10) : null;
  });

  // ---- 9b. a pattern lent as a mask reads its tile's BRIGHTNESS x alpha, as Mask > image... does ----
  // A stencil tile: white | black, the white's lower half at 50 % alpha. The first version lent the
  // tile's alpha alone, and the opaque black half masked nothing (review of 4.50 (7), 2026-09-26).
  var bwT = mkCanvas(32, 32), bwg = ctx2d(bwT);
  bwg.fillStyle = "#ffffff"; bwg.fillRect(0, 0, 16, 16);
  bwg.fillStyle = "rgba(255,255,255,0.5)"; bwg.fillRect(0, 16, 16, 16);
  bwg.fillStyle = "#000000"; bwg.fillRect(16, 0, 16, 32);
  var Lm = LayerNode.of({ type: "fill", name: "stencil", color: "#808080", visible: false, opacity: 1, blend: "normal",
    pat: { space: "uv", repeat: 8, size: 1, angle: 0, x: 0, y: 0, sharp: 4 }, patImg: bwT, patName: "stencil.png" });
  var red2 = mkCanvas(N, N); ctx2d(red2).fillStyle = "#ff0000"; ctx2d(red2).fillRect(0, 0, N, N);
  var over = LayerNode.of({ type: "paint", name: "masked", canvas: red2, visible: true, opacity: 1, blend: "normal" });
  over.maskRef = LayerNode.BELOW;                    // clip ↓
  s.layers = [Lm, over];
  flush();
  out.patMask = { white: px(s.composite, 5, 5), half: px(s.composite, 5, 21), black: px(s.composite, 21, 5), src: !!LayerNode.maskSource(s, over) };
  // ...and its sheet — the albedo's size — goes with the link, on the next whole composite, rather
  // than living as long as the pattern does; linked again, the same mask is drawn again
  var cu = LayerNode.contentOn(Lm, "color"), hadM = !!cu._maskC;
  over.maskRef = null; flush();
  var goneM = !cu._maskC;
  over.maskRef = LayerNode.BELOW; flush();
  out.patMaskPrune = { had: hadM, gone: goneM, white: px(s.composite, 5, 5), black: px(s.composite, 21, 5) };
  // ...and along the model: the mask's own evaluation in the pool, against this thread's evalTri of
  // the ORIGINAL tile read as brightness x alpha, texel by texel
  var cm = LayerNode.contentOn(Lm, "color");
  cm.pat = { space: "model", size: .4, angle: 15, x: .1, y: 0, sharp: 4 };
  flush();
  await GradFill.settle(s, GradFill.maskContent(cm), Lm);
  flush();
  var Mb = Procedural.mips(ctx2d(bwT).getImageData(0, 0, 32, 32).data, 32, 32), oraM = new Uint8ClampedArray(P.w * P.h * 4);
  Procedural.evalTri(P, Procedural.patClone(cm.pat), Mb, P.w, P.h, 0, 0, P.w, P.h, oraM);
  var comp = ctx2d(s.composite).getImageData(0, 0, N, N).data, wm = 0, lit = 0, dark = 0;
  for (var jm = 0; jm < N * N; jm++) {
    var mm = (oraM[jm*4] * 0.2126 + oraM[jm*4+1] * 0.7152 + oraM[jm*4+2] * 0.0722) / 255 * oraM[jm*4+3] / 255;
    if (mm > .9) lit++; else if (oraM[jm*4+3] === 255 && mm < .1) dark++;
    wm = Math.max(wm, Math.abs(comp[jm*4] - (128 + 127 * mm)), Math.abs(comp[jm*4+1] - 128 * (1 - mm)));
  }
  out.patMaskTri = { worst: wm, lit: lit, dark: dark };
  // an export waits for the mask's evaluation too, for the record it holds now
  cm.pat = Object.assign({}, cm.pat, { angle: 40 });
  await GradFill.ensure();
  var mc = GradFill.maskContent(cm);
  out.patMaskEnsure = GradFill.job(s, mc, Lm).key === mc._gradKey;
  out.patMaskDup = !LayerNode.contentOn(LayerNode.clone(Lm), "color")._maskC && !!cm._maskC;
  // along the model the mask outlives the link: it is at most the bake's size, and an undone unlink
  // would otherwise wait for the pool with the layer showing unmasked
  over.maskRef = null; flush();
  out.patMaskKeep = !!cm._maskC;
  over.maskRef = LayerNode.BELOW; flush();

  // ---- 10. save / load, duplicate, thumbnails ----
  var store = {}, nput = 0;
  var ctx = { put: async function(cv){ var k = "f" + (nput++); store[k] = cv; return k; }, img: async function(k){ return store[k] || null; } };
  L.grad = Object.assign(Gradient.clone(L.grad), { noise: { type: "streaks", seed: 31, scale: .3, octaves: 3, rough: .6, stretch: 12 } });
  var savedN = await ProjNode.save(L, ctx), backN = await ProjNode.load(savedN, ctx);
  var savedP = await ProjNode.save(Lp, ctx), backP = await ProjNode.load(savedP, ctx);
  out.save = { noise: JSON.stringify(backN.grad.noise) === JSON.stringify(L.grad.noise) && backN.grad.shape === "noise",
               pat: JSON.stringify(backP.pat) === JSON.stringify(Procedural.patClone(Lp.pat)), name: backP.patName,
               img: backP.patImg ? px(backP.patImg, 40, 40).slice(0, 3) : null, color: savedP.chans.color.color, file: !!savedP.chans.color.patFile };
  var fillC = LayerNode.contentOn(L, "color");
  fillC._proc = { busy: "x", p: null };
  var dup = LayerNode.clone(L), dupP = LayerNode.clone(Lp);
  out.dup = { noise: dup.grad.noise !== L.grad.noise && JSON.stringify(dup.grad.noise) === JSON.stringify(L.grad.noise),
              pat: dupP.pat !== Lp.pat, img: dupP.patImg === Lp.patImg, proc: !LayerNode.contentOn(dup, "color")._proc };
  delete fillC._proc;
  Lp._thumb = null;
  var thP = layerThumb(Lp, s);
  out.thumbP = [px(thP, 3, 3).slice(0, 3), px(thP, 9, 3).slice(0, 3)];
  out.words = [LayerNode.wordFor(fillC), LayerNode.wordFor(cp)];

  // ---- 11. the bake goes when nothing reads it ----
  s.layers = [LayerNode.of({ type: "fill", name: "flat", color: "#808080", visible: true, opacity: 1, blend: "normal" })];
  flush();
  out.pruned = !(s._bake && s._bake.pos);
  out.tilesGone = !GradFill._tileIn && GradFill._pool.mode !== "worker";   // ...and the tile the workers kept
  App.activeSlot = was; App.slots.delete("t94");
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 180000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

if (r.mode === "none") {
  R.ok("no WebGL in this browser: the page half is skipped (the position bake needs the GPU projector)");
} else {
  R.is(r.nrm && Math.abs(r.nrm[0] - 128) <= 2 && r.nrm[1] >= 253 && Math.abs(r.nrm[2] - 128) <= 2, `the position bake carries each texel's normal: a quad facing +y reads (${r.nrm})`);
  R.is(r.posPack.sent && r.posPack.mode === "worker" && r.posPack.worst === 0 && r.posPack.padded > 1000,
    `its seams are padded and its planes packed in the bake pool's worker, byte for byte this thread's packPositions of the same planes (worst ${r.posPack.worst}, ${r.posPack.padded} gutter texels padded, mode "${r.posPack.mode}")`);
  R.is(r.posPack.bare === 0, `…and every texel that holds a position holds a unit normal, the gutters too (${r.posPack.bare} without)`);
  R.is(r.async.first === null && r.async.busy, `a noise's first composite returns at once with nothing to draw while it is worked out (${r.async.ms.toFixed(1)} ms, evaluation started)`);
  R.is(r.poolMode === "worker", `…and it is worked out in the fill pool's workers, off this thread (mode "${r.poolMode}")`);
  R.is(r.sheetSize && r.sheetSize[0] === 256, `the sheet is evaluated at the bake's size (${r.sheetSize})`);
  R.is(r.oracle.worst === 0 && r.oracle.covered > 5000, `the pool's bands are byte-for-byte the main thread's own evaluation of the same bake (worst ${r.oracle.worst} over ${r.oracle.covered} covered texels)`);
  R.is(r.islands.seam === 0 && r.islands.hi - r.islands.lo > 40, `two islands holding one surface read the same noise, texel for texel (worst ${r.islands.seam}, range ${r.islands.lo}…${r.islands.hi})`);
  R.is(r.composite.at[0] === r.composite.sheet[0] && r.composite.gutter[0] === 128, `the composite shows the noise on the islands (${r.composite.at[0]} = ${r.composite.sheet[0]}) and the base in the gutter (${r.composite.gutter[0]})`);
  R.is(r.stale.same && r.stale.busy, "while a new record is worked on, the layer keeps showing the sheet it had — not a blank");
  R.is(r.inflight === 1 && r.latest.key && r.latest.moved && r.latest.runs <= 2,
    `five records set in a row start ONE evaluation; the next is the newest record, not all five (${r.latest.runs} runs in all)`);
  R.is(r.latch.reports === 1 && r.latch.fail && r.latch.settleThrows, `a failed evaluation is reported once, latched against its record, and stops an export (${r.latch.reports} report)`);
  R.is(r.ensure === true, "export's ensure() waits for the record the fill holds now");
  R.is(r.unlatched === true, "…and a record that lands lifts the failed one's latch");
  R.is(r.quickNoBar === true, "an evaluation that takes a few milliseconds never brings up the progress bar");
  R.is(r.bar.running && r.bar.upAt >= 195 && r.bar.seen && r.bar.seen.label === "Working out a test noise…" && r.bar.seen.frac >= 0,
    `a slow one does once it has run 200 ms (up at ${r.bar.upAt.toFixed(0)} ms) — labelled, and determinate while it runs (${r.bar.seen ? (r.bar.seen.frac * 100).toFixed(0) + " % at " + r.bar.seen.at.toFixed(0) + " ms" : "never"})`);
  R.is(r.opensAt.up && Math.abs(r.opensAt.frac - 3 / 8) < 1e-9 && r.opensAt.closed, `bands that land before the bar comes up count: it opens at their fraction (${(r.opensAt.frac * 100).toFixed(1)} %), not indeterminate`);
  R.is(r.cancel.cancelled && r.cancel.landed < r.bands && r.cancel.closed, r.cancel.hung
    ? "Cancel never landed: the evaluation was still running 20 s after it was pressed"
    : `Cancel stops it as a cancel after ${r.cancel.landed} of ${r.bands} bands, and the bar goes`);
  R.is(r.sticky.up && r.sticky.kept && r.sticky.closed, "the bar belongs to the content: its next evaluation inside 250 ms keeps it, and it goes after");
  R.is(r.cancelLatch.reports === 0 && r.cancelLatch.why === "cancelled" && r.cancelLatch.sheet && r.cancelLatch.settle,
    "a cancelled record is latched but not reported, the layer keeps its sheet, and an export waiting on it is told it was cancelled");
  R.is(r.exportAfterCancel === true, "…while an export asked for after the cancel works that same record out rather than refusing it");
  R.is(r.retried === true, "…and going to another record and back works it out again");
  R.is(r.mask.src && r.mask.listed && r.mask.worst <= 3, `a hidden noise lends its alpha as a mask: red over grey follows it texel by texel (worst ${r.mask.worst.toFixed(1)})`);
  R.is(r.chips.worst <= 3 && r.chips.seen > 20, `chipped paint: a noise with a mask of its own lands at noise × mask, texel by texel (worst ${r.chips.worst.toFixed(1)} over ${r.chips.seen} chipped samples)`);
  R.is(r.noiseMask.below && r.noiseMask.hidden && r.noiseMask.noise && r.noiseMask.ref && r.noiseMask.steps === 1,
    `"noise…" puts a hidden noise under the layer and masks the layer by it, as one undo step (${r.noiseMask.steps})`);
  R.is(r.noiseMaskUndo.gone && r.noiseMaskUndo.ref, "…and one Ctrl+Z takes both away");
  R.is(r.convert.kind === "paint" && r.convert.same === 0, `convert to paint waits for the evaluation and keeps its pixels (worst ${r.convert.same})`);
  R.is(r.convertUndo === true, "…and undo brings the noise back");
  R.is(r.mips.worst === 0 && r.mips.once && r.mips.mode === "worker", `a tile's mip chain is built in the pool, once per image, byte for byte this thread's (worst ${r.mips.worst})`);
  R.is(r.tri.worst === 0 && r.tri.kinds >= 4 && r.tri.key,`a pattern along the model is the main thread's own evalTri, byte for byte (worst ${r.tri.worst}, ${r.tri.kinds} colours)`);
  R.is(r.tileAsk.worst === 0 && r.tileAsk.calls > r.tileAsk.bands && r.tileAsk.differs,
    `a worker never handed the tile asks for it and gets it: still that tile, byte for byte (worst ${r.tileAsk.worst}, ${r.tileAsk.calls} sends for ${r.tileAsk.bands} bands)`);
  R.is(r.bandEdges.worst === 0 && r.bandEdges.bands > 1, `over a bake whose rows are unevenly spaced, the pool's ${r.bandEdges.bands} bands of a pattern along the model equal this thread's whole sheet at every band edge (worst ${r.bandEdges.worst})`);
  R.is(r.uv.per === 0,`a pattern on the sheet at 4 repeats is the same a whole tile (64 texels) along (worst ${r.uv.per})`);
  R.is(r.uv.tl[0] > 200 && r.uv.tl[1] < 50 && r.uv.tr[1] > 180 && r.uv.bl[2] > 200, `…with the tile's quadrants where the tile puts them (${r.uv.tl.slice(0, 3)} / ${r.uv.tr.slice(0, 3)} / ${r.uv.bl.slice(0, 3)})`);
  R.is(r.uv90.tl[2] > 200 && r.uv90.tr[0] > 200 && r.uv90.tr[1] < 50, `turned 90°, the tile's left column runs along the top (${r.uv90.tl.slice(0, 3)} / ${r.uv90.tr.slice(0, 3)})`);
  R.is(r.uvOff[1] > 180 && r.uvOff[0] < 50, `offset half a tile, green is where red was (${r.uvOff.slice(0, 3)})`);
  for (const ch of ["smooth", "metal", "wear"]) {
    const g = r.grey[ch];
    R.is(g && g[0] === g[1] && g[1] === g[2] && Math.abs(g[0] - 72) <= 12, `on the ${{ smooth: "smoothness map", metal: "metalness map", wear: "paint mask" }[ch]} a pattern is its luminance, grey (${g})`);
  }
  const near = (p, q, t) => q.every((v, i) => Math.abs(p[i] - v) <= t);
  R.is(r.patMask.src && near(r.patMask.white, [255, 0, 0], 2) && near(r.patMask.half, [192, 64, 64], 3) && near(r.patMask.black, [128, 128, 128], 2),
    `a pattern on the sheet lent as a mask reads its tile's brightness × alpha: red over white (${r.patMask.white.slice(0, 3)}), half over 50 % white (${r.patMask.half.slice(0, 3)}), none over opaque black (${r.patMask.black.slice(0, 3)})`);
  R.is(r.patMaskPrune.had && r.patMaskPrune.gone && near(r.patMaskPrune.white, [255, 0, 0], 2) && near(r.patMaskPrune.black, [128, 128, 128], 2),
    `…its sheet, the albedo's size, is let go when the link goes (${r.patMaskPrune.had && r.patMaskPrune.gone ? "gone" : "kept"}), and linked again the same mask is drawn (${r.patMaskPrune.white.slice(0, 3)} / ${r.patMaskPrune.black.slice(0, 3)})`);
  R.is(r.patMaskTri.worst <= 3 && r.patMaskTri.lit > 1000 && r.patMaskTri.dark > 1000,
    `…and along the model, its own evaluation in the pool, texel by texel against brightness × alpha of this thread's evalTri (worst ${r.patMaskTri.worst.toFixed(1)}, ${r.patMaskTri.lit} shown and ${r.patMaskTri.dark} hidden texels)`);
  R.is(r.patMaskEnsure === true, "an export waits for a pattern's mask evaluation as well as its own, for the record it holds now");
  R.is(r.patMaskDup === true, "a duplicate does not share the mask its original's pattern lends");
  R.is(r.patMaskKeep === true, "…and along the model the mask outlives its link, so an undone unlink is not worked out again");
  R.is(r.save.noise, "a noise survives save and load as its record (the format stays at version 5)");
  R.is(r.save.pat && r.save.name === "quads.png" && r.save.file && r.save.img && r.save.img[1] > 180, `a pattern survives as its record and its tile (${r.save.img})`);
  R.is(r.dup.noise && r.dup.pat && r.dup.img && r.dup.proc, "a duplicate gets records of its own, shares the tile's pixels, and not the original's evaluation in flight");
  R.is(r.thumbP[0][0] > 180 && r.thumbP[1][1] > 150, `a pattern's thumbnail draws its tile (${r.thumbP.map(p => p.join(",")).join(" / ")})`);
  R.is(r.words[0] === "a noise" && r.words[1] === "a pattern", `the panel's sentences call them what they are (${r.words.join(", ")})`);
  R.is(r.pruned === true, "the position bake is dropped once no fill on the sheet reads it");
  R.is(r.tilesKept === true && r.tilesGone === true, "the fill pool's workers keep their tile while a pattern along the model is left, and go once none is");
}
const errs = (r.__errs || []).concat(r.__rejs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors or rejections during the run:\n        " + errs.join("\n        ") : "no uncaught errors or unhandled rejections during the run");
R.finish();
