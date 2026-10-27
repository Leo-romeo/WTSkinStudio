// The cockpit carried onto the exterior's own interior sheet (ROADMAP 4.45).
//
// WHY THIS EXISTS. The transfer bake answers, for every texel of the exterior's low-detail cockpit
// sheet, "which surface of the first-person cockpit is here, and what colour is it" — and nothing in
// the app can show a wrong answer as wrong: a texel that took the glass's colour, a hidden part's, or
// a point sample of a rivet looks like paint. So the answers are held here against shapes whose
// answer is exact, in two halves.
//
//   Node, on the pure `/*==TRANSFER==*/` section (the half the transfer pool lifts into a worker),
//   with `/*==UVTRI==*/` and `/*==ENCODE==*/` beside it exactly as the pool lists them:
//   * the closest point of a triangle is right in all seven of its regions (three corners, three
//     edges, the face), distance and weights both;
//   * the tree's nearest-surface query agrees with a brute-force scan of every triangle, with and
//     without the facing rule, over a random soup — so the pruning never drops the true answer;
//   * a texel's point on the model is the affine image of its centre, a rim texel's is clamped onto
//     its triangle, a flipped V mirrors the rows, and a tiled UV (u past 1) lands on the same points;
//   * two parallel planes 2 cm apart: every texel is answered at 2 cm, at the point straight above it;
//   * the facing rule: a surface turned away is passed over for a farther one turned the same way,
//     and is still used when nothing else is within reach;
//   * the reach: a texel farther than it from every surface takes nothing;
//   * the source is read at the texel's FOOTPRINT: a one-texel checkerboard eight times finer than
//     the target carries as its mean grey, not as blotches of black and white;
//   * the closeness byte and the layer's alpha: full to 70 % of the reach, a ramp, nothing past it.
//
//   Headless Chrome, on the real page (`Transfer.cockpit`, the transfer pool, the model dialog):
//   * a synthetic exterior and cockpit where every surface the transfer must NOT read — glass by its
//     shader class, a hidden part, an effect, an unposed (skinned) part, a part with no sheet, and a
//     surface turned away (the facing rule, as the WORKER bakes) — sits CLOSER than the painted
//     surfaces it must read, so any of them leaking in changes a colour;
//   * a texel whose nearest cockpit surface is on the exterior's own sheet is passed through (alpha 0);
//   * a texel the cockpit body RENDERS on the exterior's sheet is left alone even where its nearest
//     surface lends — a lending part and a glass one, one on the exterior's island and one in its
//     gutter — and the padding treats those texels as islands of nothing (review of 4.45, 2026-09-27:
//     the layer used to repaint the cockpit's own texels);
//   * the worker's bytes are the pure section's bytes on the same input, to the byte, gutters and all,
//     with Flip V off and on — and the panel's two-toned sheet says which half each texel read;
//   * a sheet whose texture never loaded (`missing`) lends nothing; a bake smaller than its sheet is
//     scaled onto the whole of it;
//   * a cancel between chunks, and one pressed while the paint is read back, stops it, gives the worker
//     back, and the next bake works; a bake started while one runs takes the worker over, the first
//     ending as a cancel; a dialog closed mid-bake stops its bake, and the next dialog bakes cleanly;
//   * the dialog: the third entry bakes once, the reach slider re-grades without a bake, and
//     *Add as layer* puts the carried paint on top of the sheet as one undo step, the mask untouched;
//   * the three `why`s — no cockpit model, the cockpit body never opened, no exterior part on the
//     sheet — are said, not thrown, and nothing is reported as a failure;
//   * the documented reversal — deleting `MaskBake.KINDS.ck` — gives back the dialog as it was.
//
// Usage: node tools/t104_transfer.mjs [--keep] [--chrome <path>]
import fs from "fs";
import { findBrowser, evalInPage, pageExpr, makeReport, ROOT } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const src = fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8");
const sectionOf = n => {
  const a = src.search(new RegExp("[\\n>]/\\*==" + n + "==\\*/")), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("no " + n + " section in the page");
  return src.slice(a + 1, b);
};
// The three sections in the order the transfer pool lists them — the worker's own source.
const { Transfer, padSeams, rasterUVTriangles } = new Function(sectionOf("UVTRI") + "\n" + sectionOf("ENCODE") + "\n" + sectionOf("TRANSFER") +
  "\nreturn { Transfer, padSeams, rasterUVTriangles };")();

// ---- shapes ----
// A quad x0…x1 × y0…y1 at height z as two triangles, wound counter-clockwise seen from +z when `up`
// and the other way when not — so its face normal is +z or −z (wt-geometry: winding IS the normal).
function quad(x0, y0, x1, y1, z, uv, up = true){
  const c = [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
  const t = uv || [[0, 0], [1, 0], [1, 1], [0, 1]];
  const idx = up ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
  const pos = [], u = [];
  for (const k of idx) { pos.push(...c[k]); u.push(...t[k]); }
  return { pos, uv: u };
}
const cat = (list, k) => Float32Array.from(list.flatMap(q => q[k]));
const solid = (n, rgb) => { const px = new Uint8ClampedArray(n * n * 4); for (let i = 0; i < n * n; i++) px.set([rgb[0], rgb[1], rgb[2], 255], i * 4); return { rgba: px, w: n, h: n }; };
let seed = 12345;
const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
const near = (a, b, e) => Math.abs(a - b) <= e;

// ---- the closest point of a triangle, in each of its seven regions ----
{
  const tv = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), out = new Float64Array(3);
  const cases = [
    ["the face",       [.25, .25, .5], .25, .25, .25],
    ["corner 0",       [-1, -1, 0],    2,   0,   0],
    ["corner 1",       [2, -1, 0],     2,   1,   0],
    ["corner 2",       [-1, 2, 0],     2,   0,   1],
    ["edge 0–1",       [.5, -1, 0],    1,   .5,  0],
    ["edge 0–2",       [-1, .5, 0],    1,   0,   .5],
    ["edge 1–2",       [1, 1, 0],      .5,  .5,  .5],
  ];
  const bad = cases.filter(([, p, d2, v, w]) => {
    const got = Transfer.closest(tv, 0, p[0], p[1], p[2], out);
    return !(near(got, d2, 1e-9) && near(out[1], v, 1e-9) && near(out[2], w, 1e-9));
  }).map(c => c[0]);
  R.is(bad.length === 0, bad.length ? "closest point wrong in: " + bad.join(", ") : "the closest point of a triangle is right in all seven regions — three corners, three edges, the face — distance and corner weights");
}

// ---- the tree's answer is the brute-force answer ----
{
  const NT = 1500, pos = new Float32Array(NT * 9);
  for (let t = 0; t < NT; t++) {
    const cx = rnd(), cy = rnd(), cz = rnd(), s = .02 + .08 * rnd();
    for (let k = 0; k < 3; k++) { pos[t*9+k*3] = cx + s * (rnd() - .5); pos[t*9+k*3+1] = cy + s * (rnd() - .5); pos[t*9+k*3+2] = cz + s * (rnd() - .5); }
  }
  const B = Transfer.bvh(pos), fn = Transfer.faceNormals(pos), out = new Float64Array(3), tmp = new Float64Array(3);
  let wrong = 0, answered = 0, hintWrong = 0;
  for (let q = 0; q < 400; q++) {
    const px = rnd() * 1.2 - .1, py = rnd() * 1.2 - .1, pz = rnd() * 1.2 - .1;
    let nx = rnd() - .5, ny = rnd() - .5, nz = rnd() - .5; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    for (const facing of [false, 0]) for (const reach of [1e9, .05]) {
      let best = reach * reach;
      for (let t = 0; t < NT; t++) {
        if (facing !== false && fn[t*3] * nx + fn[t*3+1] * ny + fn[t*3+2] * nz <= facing) continue;
        const d2 = Transfer.closest(pos, t, px, py, pz, tmp);
        if (d2 < best) best = d2;
      }
      const got = Transfer.nearest(B, px, py, pz, nx, ny, nz, reach * reach, facing, -1, out);
      const brute = best < reach * reach ? best : -1;
      if ((got < 0) !== (brute < 0) || (got >= 0 && !near(out[0], brute, 1e-9 + 1e-6 * brute))) wrong++;
      if (got >= 0) answered++;
      // a hint (the previous texel's answer) is a starting bound, never a different answer
      const h = Math.floor(rnd() * NT), got2 = Transfer.nearest(B, px, py, pz, nx, ny, nz, reach * reach, facing, h, out);
      if ((got2 < 0) !== (brute < 0) || (got2 >= 0 && !near(out[0], brute, 1e-9 + 1e-6 * brute))) hintWrong++;
    }
  }
  R.is(wrong === 0 && answered > 400, `the tree's nearest surface is the brute-force nearest on ${NT} random triangles × 1 600 queries, with and without the facing rule and the reach (${wrong} wrong, ${answered} answered)`);
  R.is(hintWrong === 0, `…and a starting hint only bounds the search: a random hint changes no answer (${hintWrong} wrong)`);
}

// ---- which point of the model each texel is ----
{
  // A sloped rectangle whose UV is an affine image of it: texel centre → point is a known affine map.
  // Its UVs are eighths, which a float holds exactly with or without a whole tile added — so the
  // tiled copy below is the same triangle to the bit, and any texel it claims differently is the
  // transfer's doing, not a rounding of the input.
  const P0 = [0, 0, 0], P1 = [2, 0, 0], P3 = [0, 1, .5];
  const corners = [P0, P1, [2, 1, .5], P3], uvq = [[.125, .125], [.875, .125], [.875, .875], [.125, .875]];
  const mk = shift => {
    const pos = [], uv = [];
    for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...corners[k]); uv.push(uvq[k][0] + shift, uvq[k][1]); }
    return { pos: Float32Array.from(pos), uv: Float32Array.from(uv) };
  };
  const W = 64, H = 64, p = new Float64Array(3);
  const at = (u, v) => { const s = (u - .125) / .75, t = (v - .125) / .75; return [P0[0] + s * (P1[0] - P0[0]) + t * (P3[0] - P0[0]), P0[1] + s * (P1[1] - P0[1]) + t * (P3[1] - P0[1]), P0[2] + s * (P1[2] - P0[2]) + t * (P3[2] - P0[2]), s, t]; };
  const pointsOf = (q, flipV) => {
    const T = Transfer.raster(q.uv, q.pos, W, H, flipV), m = new Map();
    for (let k = 0; k < T.order.length; k++) { const i = T.order[k]; Transfer.texelPoint(T, i, p); m.set(i, [p[0], p[1], p[2]]); }
    return m;
  };
  const base = pointsOf(mk(0), false);
  let inner = 0, innerBad = 0, rimOff = 0;
  for (const [i, q] of base) {
    const x = i % W, y = (i - x) / W, e = at((x + .5) / W, 1 - (y + .5) / H);
    if (e[3] > .02 && e[3] < .98 && e[4] > .02 && e[4] < .98) { inner++; if (Math.hypot(q[0] - e[0], q[1] - e[1], q[2] - e[2]) > 1e-5) innerBad++; }
    // every point, rim or not, lies ON the rectangle: s, t in [0, 1] and on its plane
    const s = q[0] / 2, t = q[1];
    if (s < -1e-6 || s > 1 + 1e-6 || t < -1e-6 || t > 1 + 1e-6 || Math.abs(q[2] - .5 * t) > 1e-5) rimOff++;
  }
  R.is(inner > 2000 && innerBad === 0, `an interior texel's point is the affine image of its centre (${inner} checked, ${innerBad} off)`);
  R.is(rimOff === 0, `a rim texel — covered because the triangle only grazes it — is clamped onto its triangle, never off the part (${rimOff} off it of ${base.size})`);
  // Mirrored, the quad's diagonal runs the other way, and the rasteriser's slack claims a texel off a
  // 45° corner that the other diagonal does not — so the two coverages may differ by a corner texel
  // or two. That is the rasteriser's own (t60 holds it); what is the transfer's is the point.
  const flipped = pointsOf(mk(0), true);
  let both = 0, mirrorBad = 0;
  for (const [i, q] of flipped) {
    const x = i % W, y = (i - x) / W, o = base.get((H - 1 - y) * W + x);
    if (!o) continue;
    both++;
    if (Math.hypot(o[0] - q[0], o[1] - q[1], o[2] - q[2]) > 1e-5) mirrorBad++;
  }
  R.is(both > base.size - 8 && mirrorBad === 0, `a flipped V mirrors the rows: the same points, row for row (${both} texels covered both ways, ${mirrorBad} off)`);
  const tiled = pointsOf(mk(1), false);
  let tileBad = 0;
  for (const [i, q] of base) { const o = tiled.get(i); if (!o || Math.hypot(o[0] - q[0], o[1] - q[1], o[2] - q[2]) > 1e-5) tileBad++; }
  R.is(tiled.size === base.size && tileBad === 0, `a tiled UV (u from 1.125 to 1.875) claims the same texels at the same points (${tileBad} off)`);
}

// ---- the query on shapes with an exact answer ----
const TUB = quad(0, 0, 1, 1, 0, [[.1, .1], [.9, .1], [.9, .9], [.1, .9]]);
function run(tgt, srcs, side, opts){
  const S = Transfer.prepare(Object.assign({ tgtPos: cat(tgt, "pos"), tgtUV: cat(tgt, "uv"), srcPos: cat(srcs, "pos"), w: side, h: side, flipV: false, reach: .3, facing: 0 }, opts));
  Transfer.query(S, 0, S.T.order.length);
  return S;
}
// the world point a texel of TUB stands for, and back
const texelOf = (x, y, side) => { const u = .1 + .8 * x, v = .1 + .8 * y; return Math.floor((1 - v) * side) * side + Math.floor(u * side); };
{
  const over = quad(-.5, -.5, 1.5, 1.5, .02);
  const S = run([TUB], [over], 64), srcPos = cat([over], "pos");
  let n = 0, distBad = 0, ptBad = 0;
  const p = new Float64Array(3);
  for (let k = 0; k < S.T.order.length; k++) {
    const i = S.T.order[k], t = S.look.tri[i];
    n++;
    if (t < 0 || !near(S.look.dist[i], .02, 1e-6)) { distBad++; continue; }
    Transfer.texelPoint(S.T, i, p);
    const b1 = S.look.bv[i], b2 = S.look.bw[i], b0 = 1 - b1 - b2, o = t * 9;
    const q = [0, 1, 2].map(c => b0 * srcPos[o+c] + b1 * srcPos[o+3+c] + b2 * srcPos[o+6+c]);
    if (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - .02) > 1e-5 || !near(q[2], .02, 1e-6)) ptBad++;
  }
  R.is(n > 2500 && distBad === 0 && ptBad === 0, `a plane 2 cm over the part: every one of ${n} texels answered at 2 cm (${distBad} not), at the point straight above it (${ptBad} not)`);

  // the facing rule
  const under = quad(-.5, -.5, 1.5, 1.5, .01, null, false), farUp = quad(-.5, -.5, 1.5, 1.5, .03);
  const dists = S2 => { const d = new Set(); for (let k = 0; k < S2.T.order.length; k++) { const i = S2.T.order[k]; d.add(S2.look.tri[i] < 0 ? -1 : Math.round(S2.look.dist[i] * 1000)); } return [...d].sort((a, b) => a - b).join(","); };
  const fac = dists(run([TUB], [under, farUp], 64)), any = dists(run([TUB], [under, farUp], 64, { facing: false })), only = dists(run([TUB], [under], 64));
  R.is(fac === "30", `a surface turned away (1 cm, facing −z) is passed over for one turned the same way (3 cm): every texel at ${fac} mm`);
  R.is(any === "10", `…with the facing rule off the nearer one wins: ${any} mm`);
  R.is(only === "10", `…and when nothing facing is within reach, the one turned away is used rather than nothing: ${only} mm`);

  // the reach
  const half = quad(-.5, -.5, .5, 1.5, .02);
  const S3 = run([TUB], [half], 64);
  const inReach = S3.look.tri[texelOf(.6, .5, 64)], outReach = S3.look.tri[texelOf(.9, .5, 64)];
  const dEdge = S3.look.dist[texelOf(.6, .5, 64)];
  R.is(inReach >= 0 && near(dEdge, Math.hypot(.1, .02), .02) && outReach < 0,
    `the reach: 10 cm past the source's edge is answered (${dEdge.toFixed(3)} m), 40 cm past it is not (tri ${outReach})`);
}

// ---- reading the colour: at the texel's footprint, passed through, and the closeness byte ----
{
  // 520 source texels to 64 target ones: 8.125 a texel, so a point read wanders across the
  // checkerboard's phase from one target texel to the next — the spread the footprint check has to
  // be told apart from. (At exactly 8 every point read lands on the same phase and agrees with
  // itself, which proves nothing.)
  const side = 64, SW = 520;
  const cb = { rgba: new Uint8ClampedArray(SW * SW * 4), w: SW, h: SW };
  for (let y = 0; y < SW; y++) for (let x = 0; x < SW; x++) { const v = (x + y) & 1 ? 255 : 0; cb.rgba.set([v, v, v, 255], (y * SW + x) * 4); }
  const tub = quad(0, 0, 1, 1, 0), src = quad(0, 0, 1, 1, .01);
  const S = run([tub], [src], side);
  const srcUV = cat([src], "uv"), scale = Transfer.uvPerMetre(cat([src], "pos"), srcUV), sheet = new Int16Array(2);
  const rgba = Transfer.sample(S.look, { uv: srcUV, sheet, scale }, [Transfer.mips(cb)], side, side, false, .3);
  let lo = 255, hi = 0;
  for (let i = 0; i < side * side; i++) { if (!rgba[i*4+3]) continue; lo = Math.min(lo, rgba[i*4]); hi = Math.max(hi, rgba[i*4]); }
  R.is(lo >= 126 && hi <= 130, `a one-texel checkerboard about eight times finer than the sheet carries as its mean grey (${lo}–${hi}), not as blotches of black and white — the source is read at the texel's footprint, 8.125 of its texels`);
  const pt = Transfer.sample(S.look, { uv: srcUV, sheet, scale }, [[cb]], side, side, false, .3);   // a chain of one level: a point read
  let plo = 255, phi = 0;
  for (let i = 0; i < side * side; i++) { if (!pt[i*4+3]) continue; plo = Math.min(plo, pt[i*4]); phi = Math.max(phi, pt[i*4]); }
  R.is(phi - plo > 100, `…where a point read of the same sheet spreads ${plo}–${phi}: the footprint is what the check above measures`);
  const pass = Transfer.sample(S.look, { uv: srcUV, sheet, scale }, [null], side, side, false, .3);
  let lit = 0; for (let i = 3; i < pass.length; i += 4) if (pass[i]) lit++;
  R.is(lit === 0, `a sheet passed through (the target itself) lends nothing: ${lit} texels with alpha`);
  const a = rgba[(side * (side >> 1) + (side >> 1)) * 4 + 3];
  R.is(a === 1 + Math.round(254 * (1 - .01 / .3)), `the alpha byte carries the distance: ${a} at 1 cm of a 30 cm reach`);
  const byte = d => 1 + Math.round(254 * Math.max(0, 1 - d / .3));
  const al = d => Transfer.alpha(byte(d), .3, .05);
  R.is(Transfer.alpha(0, .3, .05) === 0 && al(0) === 255 && al(.03) === 255 && al(.0425) >= 120 && al(.0425) <= 135 && al(.06) === 0,
    `the layer's alpha at a 5 cm reach: none for "nothing here", full at 0 and at 3 cm, half at 4.25 cm (${al(.0425)}), none at 6 cm`);
  const st = Transfer.stats(S.look, sheet, 1, rgba);
  R.is(st.covered === S.T.order.length && st.answered === st.covered && st.bySheet[0] === st.answered && st.hist[a] === st.covered,
    `the stats count what the bake found: ${st.covered} covered, ${st.answered} answered, ${st.hist[a]} of them at the 1 cm byte`);
}

/// ---- the real page ----
// One scene, built here and handed to the page as plain numbers, so the Node half below runs the
// pure section over EXACTLY the input the worker gets — and can hold the worker to its bytes.
const Q = "t104_cockpit::";
const TGT_SIDE = 128;
// The panel's sheet is two-toned — its top half one colour, its bottom half another — so which half
// a carried texel shows says which way up the source was read: with Flip V on, the other half.
const PANEL_TOP = [200, 40, 30], PANEL_BOT = [150, 30, 160];
const SCENE = {
  side: TGT_SIDE, panelTop: PANEL_TOP, panelBot: PANEL_BOT,
  ext: [
    { name: "tub",   mat: "tub_mat",   ...TUB },
    // a far island on the same sheet: out of every surface's reach
    { name: "hatch", mat: "tub_mat",   ...quad(2, 0, 2.5, .5, 0, [[.93, .1], [.98, .1], [.98, .5], [.93, .5]]) },
    // another sheet's part, which is not a target
    { name: "skin",  mat: "skin_mat",  ...quad(0, 0, 1, 1, -.5, [[.1, .1], [.9, .1], [.9, .9], [.1, .9]]) },
  ],
  // The cockpit, in its own order. Every part the transfer must pass over sits NEARER the tub than
  // the painted panel and seat, so any of them leaking in changes the colour the checks read.
  ck: [
    { name: "glass",     mat: Q + "glass_mat", ...quad(-.2, -.2, 1.2, 1.2, .01) },    // glass by its shader class
    { name: "wiring",    mat: Q + "wire_mat",  ...quad(-.2, -.2, 1.2, 1.2, .005) },   // hidden on the cockpit body
    { name: "gunfire_l", mat: Q + "fx_mat",    ...quad(-.2, -.2, 1.2, 1.2, .004) },   // an effect
    { name: "strap",     mat: Q + "wire_mat",  ...quad(-.2, -.2, 1.2, 1.2, .003), skinned: true },   // unposed
    { name: "orphan",    mat: Q + "none_mat",  ...quad(-.2, -.2, 1.2, 1.2, .002) },   // no sheet at all
    { name: "panel",     mat: Q + "panel_mat", ...quad(-.2, -.2, .5, 1.2, .02) },
    // the panel's underside, modelled as its own sheet of triangles facing DOWN and nearer the tub
    // than the panel: the facing rule passes it over, so its colour must show nowhere
    { name: "under",     mat: Q + "under_mat", ...quad(-.2, -.2, .5, 1.2, .012, null, false) },
    { name: "seat",      mat: Q + "seat_mat",  ...quad(.5, -.2, 1.2, 1.2, .02) },
    // on the exterior's OWN sheet, nearer than the panel over the tub's top strip: passed through.
    // Its texels are a strip of their own above the tub's island.
    { name: "sill",      mat: Q + "sill_mat",  ...quad(-.2, .8, 1.2, 1.2, .015, [[.1, .93], [.9, .93], [.9, .98], [.1, .98]]) },
    // The cockpit body's own texels on the exterior's sheet, on parts far from every exterior surface
    // (so never the nearest): `copy` — painted, so a source like any other — paints the tub island's
    // lower-left corner, the way a shared layout does; `placard` — glass, so it lends nothing — a strip
    // in the gutter left of the island. The first-person cockpit renders both, so the layer must not.
    // The copy's right edge is at u = 19.75 / 64: in the half of its texel at half size (the upscale
    // case below) nearer its lit neighbour, where a smooth scale-up leans onto a texel it renders.
    { name: "copy",      mat: Q + "sill_mat",    ...quad(5, 5, 5.25, 5.25, 0, [[.1, .1], [19.75 / 64, .1], [19.75 / 64, .3], [.1, .3]]) },
    { name: "placard",   mat: Q + "placard_mat", ...quad(5, 6, 5.1, 6.5, 0, [[.02, .55], [.08, .55], [.08, .75], [.02, .75]]) },
  ],
  hidden: ["wiring"],
  matSlot: [["tub_mat", "ext_interior_c"], ["skin_mat", "ext_skin_c"], [Q + "glass_mat", "ck_glass_c"], [Q + "wire_mat", "ck_other_c"],
            [Q + "fx_mat", "ck_other_c"], [Q + "panel_mat", "ck_panel_c"], [Q + "under_mat", "ck_under_c"], [Q + "seat_mat", "ck_seat_c"],
            [Q + "sill_mat", "ext_interior_c"], [Q + "placard_mat", "ext_interior_c"]],
  desc: [[Q + "glass_mat", { cls: "dynamic_masked_glass_chrome" }], [Q + "panel_mat", { cls: "dynamic_simple" }],
         [Q + "placard_mat", { cls: "dynamic_masked_glass_chrome" }]],
  colours: { ext_interior_c: [90, 90, 90], ext_skin_c: [100, 120, 80], ck_panel_c: PANEL_TOP, ck_seat_c: [30, 60, 190],
             ck_under_c: [250, 200, 0], ck_glass_c: [255, 255, 255], ck_other_c: [0, 255, 0] },
};
const SEAT = SCENE.colours.ck_seat_c, UNDER = SCENE.colours.ck_under_c;
// The sheets as the page paints them: a flat colour each, the panel's two halves.
function sheetImage(id, n){
  if (id !== "ck_panel_c") return solid(n, SCENE.colours[id]);
  const img = solid(n, PANEL_TOP);
  for (let i = n * n / 2; i < n * n; i++) img.rgba.set([...PANEL_BOT, 255], i * 4);
  return img;
}
// What the pure section makes of that scene — the transfer's own rules, applied by hand: the tub and
// the hatch are the targets; the panel, its underside, the seat, the sill and the copy the sources,
// in the cockpit's order; the sill, the copy and the placard the cockpit's own texels on the sheet.
// `keep: false` and `padAll: false` are the two halves of the fix the review of 4.45 asked for,
// taken out one at a time, so each check below that reads them is shown to tell them apart.
const SRC = ["panel", "under", "seat", "sill", "copy"], SHEETS = ["ck_panel_c", "ck_under_c", "ck_seat_c", "ext_interior_c"];
const KEEP = ["sill", "copy", "placard"];
function pureScene(flipV, pad, { keep = true, padAll = true } = {}){
  const tgt = SCENE.ext.filter(p => p.mat === "tub_mat"), srcs = SCENE.ck.filter(p => SRC.includes(p.name));
  const srcSheet = new Int16Array(srcs.length * 2);
  srcs.forEach((p, j) => srcSheet.fill(SHEETS.indexOf(new Map(SCENE.matSlot).get(p.mat)), j * 2, j * 2 + 2));
  const srcPos = cat(srcs, "pos"), srcUV = cat(srcs, "uv");
  const S = Transfer.prepare({ tgtPos: cat(tgt, "pos"), tgtUV: cat(tgt, "uv"), srcPos, w: TGT_SIDE, h: TGT_SIDE, flipV, reach: .3, facing: 0,
                               keepUV: keep ? cat(SCENE.ck.filter(p => KEEP.includes(p.name)), "uv") : null });
  Transfer.query(S, 0, S.T.order.length);
  const sheets = SHEETS.map(id => id === "ext_interior_c" ? null : Transfer.mips(sheetImage(id, 64)));
  const rgba = Transfer.sample(S.look, { uv: srcUV, sheet: srcSheet, scale: Transfer.uvPerMetre(srcPos, srcUV) }, sheets, TGT_SIDE, TGT_SIDE, flipV, .3);
  if (padAll) Transfer.pad(S.look, rgba, TGT_SIDE, TGT_SIDE, pad);
  else padSeams(rgba, TGT_SIDE, TGT_SIDE, S.look.cov, pad);
  return { rgba, S };
}

const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { R.finish("SKIP: no Chrome or Edge found for the page half. Pass --chrome <path> or set CHROME."); }

const BODY = `async function(){
  var out = {}, SC = ${JSON.stringify(SCENE)};
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var rgb = function(c){ return "rgb(" + c.join(",") + ")"; };
  var sheet = function(id, n){
    var c = mkCanvas(n, n), g = ctx2d(c);
    g.fillStyle = rgb(SC.colours[id]); g.fillRect(0, 0, n, n);
    if (id === "ck_panel_c") { g.fillStyle = rgb(SC.panelBot); g.fillRect(0, n / 2, n, n / 2); }
    return c;
  };
  var b64 = function(u8){ var s = ""; for (var i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };
  var part = function(p){ return { name: p.name, mat: p.mat, position: new Float32Array(p.pos), uv: new Float32Array(p.uv), tris: p.pos.length / 9, skinned: !!p.skinned }; };
  // everything the run reports as a failure, and every status line it sets
  var failures = [], status = [], realReport = reportFailure, realStatus = setStatus;
  window.reportFailure = function(what, err){ failures.push(what + " :: " + (err && err.message || err)); };
  window.setStatus = function(msg){ status.push(String(msg)); return realStatus.apply(this, arguments); };
  Object.keys(SC.colours).forEach(function(id){
    var n = id === "ext_interior_c" ? SC.side : 64;
    App.slots.set(id, { id: id, size: n, nSize: n, layers: [], missing: false, baseC: sheet(id, n), composite: sheet(id, n), normal: null, smooth: null, metal: null });
  });
  var target = App.slots.get("ext_interior_c");
  App.matSlot = new Map(SC.matSlot);
  App.geomData = SC.ext.map(part);
  App.meshes = new Map(); App.geomData.forEach(function(g){ App.meshes.set(g.name, { visible: true }); });
  App.body = "exterior"; App.hiddenParts = new Set(); App.selParts = new Set(); App.protectedParts = new Set();
  App.vehicleKey = "t104";
  $("optFlipV").checked = false;
  out.pad = Bake.PAD;
  var P = Transfer.cockpit.workers(), chunk = Transfer.cockpit.CHUNK;
  var bytes = function(res){ return b64(new Uint8Array(res.rgba.buffer)); };

  // ---- the three states that are said, not thrown ----
  App.bodies = {};
  out.whyNone = Transfer.cockpit.gather(target).why || "";
  App.bodies = { cockpit: Cockpit.fresh({ geomData: null, objName: "t104_cockpit" }) };
  out.whyClosed = Transfer.cockpit.gather(target).why || "";
  App.bodies = { cockpit: Cockpit.fresh({ geomData: SC.ck.map(part), bind: { map: new Map(SC.desc), materials: [] },
                                          hiddenParts: new Set(SC.hidden), objName: "t104_cockpit" }) };
  out.whyNoExt = Transfer.cockpit.gather(App.slots.get("ck_panel_c")).why || "";
  var g = Transfer.cockpit.gather(target);
  out.gather = g.why ? { why: g.why } : { tgt: g.tgt.map(function(x){ return x.name; }), src: g.src.map(function(x){ return x.gd.name; }),
                                          sheets: g.sheets.map(function(s){ return s.id; }), keep: g.keep.map(function(x){ return x.name; }) };

  // ---- the bake, through the worker: Flip V off, then on ----
  var res = await Transfer.cockpit.bake(target);
  out.mode = P.mode;
  out.res = { w: res.w, h: res.h, rgba: bytes(res), stats: res.stats, sheets: res.sheets, pass: res.pass, own: res.own };
  $("optFlipV").checked = true;
  var resV = await Transfer.cockpit.bake(target);
  $("optFlipV").checked = false;
  out.resV = { w: resV.w, rgba: bytes(resV) };

  // ---- a sheet whose texture never loaded lends nothing ----
  App.slots.get("ck_seat_c").missing = true;
  var resM = await Transfer.cockpit.bake(target);
  App.slots.get("ck_seat_c").missing = false;
  out.resM = { rgba: bytes(resM), pass: resM.pass };

  // ---- a bake smaller than its sheet (any sheet over SIDE) is scaled onto the whole of it ----
  var side = Transfer.cockpit.SIDE;
  Transfer.cockpit.SIDE = SC.side / 2;
  var resU = await Transfer.cockpit.bake(target);
  Transfer.cockpit.SIDE = side;
  var nU = target.layers.length, LU = Transfer.cockpit.place(target, resU, .05);
  out.up = { w: resU.w, added: target.layers.length - nU, size: [LU.canvas.width, LU.canvas.height],
             layer: b64(new Uint8Array(ctx2d(LU.canvas).getImageData(0, 0, LU.canvas.width, LU.canvas.height).data.buffer)) };
  doUndo();
  out.up.afterUndo = target.layers.length - nU;

  // ---- a cancel between chunks ----
  var orig = P.call, queries = 0, cancelErr = null;
  Transfer.cockpit.CHUNK = 1024;
  P.call = function(op){ var r = orig.apply(P, arguments); if (op === "query" && ++queries === 1) r.then(function(){ Prog.cancelled = true; }); return r; };
  try { await Transfer.cockpit.bake(target); } catch (e) { cancelErr = e; }
  P.call = orig; Transfer.cockpit.CHUNK = chunk;
  out.cancel = { name: cancelErr && cancelErr.name, queries: queries, workers: P.workers.length, mode: P.mode };
  out.cancel.again = bytes(await Transfer.cockpit.bake(target)) === out.res.rgba;

  // ---- a cancel pressed while the paint is read back: the last step, where the bar sits longest ----
  var sErr = null, sRes = null;
  P.call = function(op){ if (op === "sample") Prog.cancelled = true; return orig.apply(P, arguments); };
  try { sRes = await Transfer.cockpit.bake(target); } catch (e) { sErr = e; }
  P.call = orig;
  out.sampleCancel = { name: sErr ? sErr.name : "", resolved: !!sRes, workers: P.workers.length, mode: P.mode, bar: Prog.active };

  // ---- a bake started while one runs takes the worker over; the first ends as a cancel ----
  Transfer.cockpit.CHUNK = 512;
  var q2 = 0, second;
  var atQ2 = new Promise(function(r){ second = r; });
  P.call = function(op){ var r = orig.apply(P, arguments); if (op === "query" && ++q2 === 2) second(); return r; };
  var p1 = Transfer.cockpit.bake(target);
  await atQ2;
  P.call = orig;
  var p2 = Transfer.cockpit.bake(target), barMid = null;
  p1.then(null, function(){}).then(function(){ barMid = Prog.active; });   // the first has ended; the second has not
  var both = await Promise.allSettled([p1, p2]);
  Transfer.cockpit.CHUNK = chunk;
  out.twice = { first: both[0].status === "rejected" ? both[0].reason.name + ": " + both[0].reason.message : "resolved",
                second: both[1].status === "fulfilled" && bytes(both[1].value) === out.res.rgba, barMid: barMid, bar: Prog.active, live: Transfer.cockpit.live };

  // ---- the dialog ----
  var L = LayerNode.of({ type: "paint", name: "Base paint", canvas: mkCanvas(SC.side, SC.side), visible: true, opacity: 1, blend: "normal" });
  target.layers.push(L);
  App.activeSlot = target; App.activeLayer = L;
  var builds = 0;
  P.call = function(op){ if (op === "build") builds++; return orig.apply(P, arguments); };
  MaskBake.open(target, L);
  var ov = $("modalHost").lastElementChild, dlg = out.dlg = {};
  var btnIn = function(o, t){ return [].slice.call(o.querySelectorAll("button")).filter(function(b){ return b.textContent === t; })[0]; };
  var btn = function(t){ return btnIn(ov, t); };
  dlg.title = ov.querySelector("h2").textContent;
  dlg.kinds = ["Curvature", "Occlusion", "From the cockpit"].map(function(t){ var b = btn(t); return b ? (b.disabled ? "off" : "on") + (b.classList.contains("active") ? "*" : "") : "absent"; });
  var use = btn("Add as layer");
  for (var w = 0; w < 600 && (!use || use.disabled); w++) { await sleep(50); use = btn("Add as layer"); }
  var note = ov.querySelector(".hint");
  dlg.note1 = note.textContent;
  dlg.ready = !!use && !use.disabled;
  btn("From the cockpit").click();                             // again: the same dialog does not bake twice
  for (var w2 = 0; w2 < 100 && Prog.active; w2++) await sleep(20);
  dlg.builds = builds;
  var reach = [].slice.call(ov.querySelectorAll(".row")).filter(function(r){ var l = r.querySelector("label"); return l && l.textContent === "Reach"; })[0].querySelector("input");
  dlg.reachShown = reach.closest(".row").style.display !== "none";
  reach.value = ".01"; reach.dispatchEvent(new Event("input"));
  dlg.note2 = note.textContent; dlg.off2 = btn("Add as layer").disabled;
  reach.value = ".05"; reach.dispatchEvent(new Event("input"));
  dlg.note3 = note.textContent; dlg.off3 = btn("Add as layer").disabled;
  var n0 = target.layers.length;
  btn("Add as layer").click();
  P.call = orig;
  dlg.closed = !ov.isConnected;
  dlg.added = target.layers.length - n0;
  var top = target.layers[target.layers.length - 1];
  dlg.name = top && top.name; dlg.maskUntouched = !L.mask && !L.maskRef;
  dlg.undoDesc = App.undoStack.length ? App.undoStack[App.undoStack.length - 1].desc : "";
  dlg.size = top && top.canvas ? [top.canvas.width, top.canvas.height] : null;
  dlg.layer = top && top.canvas ? b64(new Uint8Array(ctx2d(top.canvas).getImageData(0, 0, top.canvas.width, top.canvas.height).data.buffer)) : "";
  doUndo();
  dlg.afterUndo = target.layers.length - n0;

  // ---- a dialog closed mid-bake stops its bake; the next one bakes cleanly ----
  Transfer.cockpit.CHUNK = 512;
  var q3 = 0, mid;
  var atMid = new Promise(function(r){ mid = r; });
  P.call = function(op){ var r = orig.apply(P, arguments); if (op === "query" && ++q3 === 2) mid(); return r; };
  MaskBake.open(target, L);
  var ovA = $("modalHost").lastElementChild;
  await atMid;
  P.call = orig;
  ovA.querySelector(".x").click();                              // the ✕, with the bake half done
  await sleep(150);
  var cm = out.closeMid = { connected: ovA.isConnected, bar: Prog.active, workers: P.workers.length, mode: P.mode, live: Transfer.cockpit.live };
  MaskBake.open(target, L);
  var ovB = $("modalHost").lastElementChild, useB = null;
  for (var w3 = 0; w3 < 600; w3++) { useB = btnIn(ovB, "Add as layer"); if (useB && !useB.disabled) break; await sleep(50); }
  cm.ready = !!useB && !useB.disabled;
  cm.note = ovB.querySelector(".hint").textContent;
  ovB.querySelector(".x").click();
  Transfer.cockpit.CHUNK = chunk;

  // ---- the documented reversal: without KINDS.ck the dialog is 4.44's again ----
  var ckKind = MaskBake.KINDS.ck, before = $("modalHost").children.length, threw = null;
  delete MaskBake.KINDS.ck;
  status.length = 0;
  try { MaskBake.open(target, L); } catch (e) { threw = String(e && e.message || e); }
  out.rev = { threw: threw, opened: $("modalHost").children.length - before, status: status.join(" | ") };
  if ($("modalHost").children.length > before) $("modalHost").lastElementChild.querySelector(".x").click();
  MaskBake.KINDS.ck = ckKind;

  out.failures = failures;
  window.reportFailure = realReport; window.setStatus = realStatus;
  return out;
}`;

const run2 = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 240000, keep: argv.includes("--keep") });
if (!run2.ok) { console.log("FAIL: " + run2.reason); process.exit(1); }
const r = run2.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }
const unb64 = s => new Uint8Array(Buffer.from(s, "base64"));

R.is(/no cockpit model/.test(r.whyNone), `no cockpit model is said: "${r.whyNone}"`);
R.is(/Open the cockpit body once/.test(r.whyClosed), `a cockpit body never opened is said: "${r.whyClosed}"`);
R.is(/No part of the exterior uses/.test(r.whyNoExt), `a sheet no exterior part uses is said: "${r.whyNoExt}"`);
R.is(!r.gather.why && r.gather.tgt.join() === "tub,hatch" && r.gather.src.join() === SRC.join() && r.gather.keep.join() === KEEP.join(),
  r.gather.why ? "gather refused: " + r.gather.why
    : `the targets are the exterior's parts on the sheet (${r.gather.tgt.join(", ")}), the sources the cockpit's painted ones (${r.gather.src.join(", ")}) — not the glass, the hidden part, the effect, the unposed part or the part with no sheet — and every cockpit part on the sheet, glass too, marks what the cockpit renders there (${r.gather.keep.join(", ")})`);
R.is(r.mode === "worker", `the bake ran in a real worker (pool mode "${r.mode}") — the three sections are self-contained`);

const W = r.res.w, got = unb64(r.res.rgba), gotV = unb64(r.resV.rgba);
const want = pureScene(false, r.pad), wantV = pureScene(true, r.pad);
const differ = (a, b) => { let d = a.length === b.length ? 0 : Infinity; for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++; return d; };
const dF = differ(got, want.rgba), dV = differ(gotV, wantV.rgba);
R.is(W === TGT_SIDE && r.resV.w === TGT_SIDE && dF === 0 && dV === 0,
  `the worker's bytes are the pure section's on the same input, gutters included, with Flip V off and on (${dF} and ${dV} of ${got.length} bytes differ)`);

// what the colours are, region by region (texel of a world point on the tub)
const tex = (x, y, flip = false) => { const u = .1 + .8 * x, v = .1 + .8 * y, row = Math.floor((flip ? v : 1 - v) * W); return (row * W + Math.floor(u * W)) * 4; };
const region = (px, x0, x1, y0, y1, fn, flip = false) => { let bad = 0, n = 0; for (let x = x0; x <= x1 + 1e-9; x += .05) for (let y = y0; y <= y1 + 1e-9; y += .05) { n++; if (!fn(px, tex(x, y, flip), y)) bad++; } return { bad, n }; };
const is = (rgb, a) => (px, i) => px[i] === rgb[0] && px[i+1] === rgb[1] && px[i+2] === rgb[2] && px[i+3] === a;
// the panel's half a tub point reads: its v on the panel's UV, flipped with the model's
const panelAt = (y, flip) => ((y + .2) / 1.4 > .5) !== flip ? PANEL_TOP : PANEL_BOT;
const isPanel = (a, flip) => (px, i, y) => is(panelAt(y, flip), a)(px, i);
const A238 = 1 + Math.round(254 * (1 - .02 / .3));
const regions = (px, flip) => [region(px, .3, .45, .05, .4, isPanel(A238, flip), flip), region(px, .05, .45, .6, .75, isPanel(A238, flip), flip),
                               region(px, .6, .95, .05, .7, is(SEAT, A238), flip)];
const sum = rs => rs.reduce((a, q) => ({ bad: a.bad + q.bad, n: a.n + q.n }), { bad: 0, n: 0 });
const rF = sum(regions(got, false)), rV = sum(regions(gotV, true));
R.is(rF.bad === 0 && rV.bad === 0,
  `under the panel the tub carries the panel's colour — the half its V reads, so the other half with Flip V on — and under the seat the seat's, all at the 2 cm byte ${A238} (${rF.bad} and ${rV.bad} of ${rF.n} sampled texels off)`);
let under = 0; for (let i = 0; i < got.length; i += 4) if (got[i+3] && got[i] === UNDER[0] && got[i+1] === UNDER[1] && got[i+2] === UNDER[2]) under++;
R.is(under === 0 && r.res.pass[1], `the panel's underside — nearer, but facing away — lends nowhere as the worker bakes it (${under} texels of its colour; its sheet ${r.res.pass[1] ? "never read" : "read"})`);
const rpass = region(got, .05, .95, .86, .95, (px, i) => px[i+3] === 0);
R.is(rpass.bad === 0, `where the cockpit's nearest surface is on the exterior's own sheet the texel is left alone — alpha 0 (${rpass.bad} of ${rpass.n} off)`);
// the texels the cockpit renders itself, on the island: kept, where the same bake without them lends
const noKeep = pureScene(false, r.pad, { keep: false }).rgba;
const rk = region(got, .02, .22, .02, .22, (px, i) => px[i+3] === 0), rkWas = region(noKeep, .02, .22, .02, .22, (px, i, y) => is(panelAt(y, false), A238)(px, i));
R.is(rk.bad === 0 && rkWas.bad === 0,
  `a texel the cockpit body renders on the exterior's island is left alone (${rk.bad} of ${rk.n} off) — though its nearest surface is the panel, which it carries without them (${rkWas.n - rkWas.bad} of ${rkWas.n})`);
// the hatch's island (u .93–.98, v .1–.5), well inside it
const rowOf = v => Math.floor((1 - v) * W);
const hatch = (() => { let lit = 0, n = 0; for (let v = .15; v <= .45; v += .01) for (let x = Math.ceil(.94 * W); x < Math.floor(.97 * W); x++) { n++; if (got[(rowOf(v) * W + x) * 4 + 3]) lit++; } return { lit, n }; })();
R.is(hatch.n > 50 && hatch.lit === 0, `an island out of every surface's reach carries nothing (${hatch.lit} of ${hatch.n} texels lit)`);
// the gutter left of the tub's island, against the island's first covered texel in that row
const cov = want.S.look.cov;
const gutterRow = v => { const gy = rowOf(v); let rimX = 0; while (rimX < W && !cov[gy * W + rimX]) rimX++; return { gy, rimX, g: (gy * W + 4) * 4, rim: (gy * W + rimX) * 4 }; };
const G = gutterRow(.4);
R.is(G.rimX > 4 && !cov[G.gy * W + 4] && got[G.g+3] === got[G.rim+3] && got[G.g] === got[G.rim] && got[G.g+1] === got[G.rim+1] && got[G.g+2] === got[G.rim+2] && got[G.rim+3] > 0,
  `the gutter left of the island is padded from its rim (texel ${G.rimX}), closeness byte and all (${got[G.g]},${got[G.g+1]},${got[G.g+2]} @${got[G.g+3]})`);
const K = gutterRow(.2);
R.is(!cov[K.gy * W + 4] && got[K.g+3] === 0 && got[K.rim+3] === 0 && noKeep[K.g+3] > 0,
  `…and where the rim is a texel the cockpit renders, the gutter beside it carries nothing (@${got[K.g+3]}; @${noKeep[K.g+3]} without the cockpit's texels)`);
// the placard: glass on the exterior's sheet, in the gutter beside the island
const oldPad = pureScene(false, r.pad, { padAll: false }).rgba;
const placard = (px => { let lit = 0, n = 0; for (let y = 36; y <= 55; y++) for (let x = 3; x <= 9; x++) { n++; if (px[(y * W + x) * 4 + 3]) lit++; } return { lit, n }; });
const pl = placard(got), plWas = placard(oldPad);
R.is(pl.lit === 0 && plWas.lit === plWas.n,
  `the padding leaves the cockpit's own texels in the gutter alone — the glass placard beside the island (${pl.lit} of ${pl.n} lit; padded from the exterior's coverage alone, ${plWas.lit})`);
const st = r.res.stats;
const kept = (() => { let n = 0; for (let i = 0; i < cov.length; i++) if (cov[i] && want.S.look.keep[i]) n++; return n; })();
R.is(r.res.pass.join() === "false,true,false,true" && r.res.own === 3 && st.bySheet[3] > 0 && st.kept === kept && kept > 400 && st.answered + st.kept < st.covered,
  `the result says which sheets lent (${r.res.sheets.map((s, k) => s + (r.res.pass[k] ? " passed" : " lent")).join(", ")}), and how much of the sheet the cockpit paints itself: ${st.bySheet[3]} texels nearest the sill, ${st.kept} it renders (${kept} by hand)`);

// a missing sheet, and a bake scaled onto its sheet
const gotM = unb64(r.resM.rgba), rM = region(gotM, .6, .95, .05, .7, (px, i) => px[i+3] === 0), rMp = region(gotM, .3, .45, .05, .4, isPanel(A238, false));
R.is(r.resM.pass.join() === "false,true,true,true" && rM.bad === 0 && rMp.bad === 0,
  `a sheet whose texture never loaded lends nothing: the seat's texels are left alone (${rM.bad} of ${rM.n} off) while the panel's still carry (${rMp.bad} off)`);
const up = r.up, lu = unb64(up.layer), LWu = up.size[0];
const lt = (px, LW, x, y) => { const u = .1 + .8 * x, v = .1 + .8 * y; return (Math.floor((1 - v) * LW) * LW + Math.floor(u * LW)) * 4; };
const upOk = [[.4, .2, PANEL_BOT], [.2, .65, PANEL_TOP], [.8, .2, SEAT], [.8, .65, SEAT]].filter(([x, y, c]) => { const i = lt(lu, LWu, x, y); return lu[i] === c[0] && lu[i+1] === c[1] && lu[i+2] === c[2] && lu[i+3] === 255; }).length;
R.is(up.w === TGT_SIDE / 2 && up.added === 1 && LWu === TGT_SIDE && up.size[1] === TGT_SIDE && upOk === 4 && up.afterUndo === 0,
  `a bake at ${up.w}² for a ${TGT_SIDE}² sheet is scaled onto the whole sheet: the layer is ${up.size.join("×")} and ${upOk} of 4 points across it carry their colour at full alpha`);
// ...and not onto a texel the cockpit renders at the SHEET's size, which the bake saw only at its own
const keepFull = new Uint8Array(TGT_SIDE * TGT_SIDE);
rasterUVTriangles(keepFull, cat(SCENE.ck.filter(p => KEEP.includes(p.name)), "uv"), TGT_SIDE, TGT_SIDE, false, 1);
let upKeep = 0, upKeepLit = 0;
for (let i = 0; i < keepFull.length; i++) if (keepFull[i]) { upKeep++; if (lu[i*4+3]) upKeepLit++; }
R.is(upKeep > 900 && upKeepLit === 0,
  `…and the scaled layer leaves every texel the cockpit renders at the sheet's own size alone (${upKeepLit} of ${upKeep} painted) — its edge cut back to the bake's texel for texel`);

R.is(r.cancel.name === "Cancelled" && r.cancel.queries === 1 && r.cancel.workers === 0 && r.cancel.mode === "unstarted",
  `a cancel between chunks stops the bake after ${r.cancel.queries} query and gives the worker back (${r.cancel.workers} workers, pool ${r.cancel.mode})`);
R.is(r.cancel.again, "…and the next bake respawns the pool and makes the same bytes");
const sc = r.sampleCancel;
R.is(sc.name === "Cancelled" && !sc.resolved && sc.workers === 0 && sc.mode === "unstarted" && !sc.bar,
  `a Cancel pressed while the paint is read back — the last step — cancels the bake rather than handing back its result (${sc.name || "resolved"}; ${sc.workers} workers, pool ${sc.mode})`);
const tw = r.twice;
R.is(/^Cancelled/.test(tw.first) && tw.second && tw.barMid === true && !tw.bar && tw.live === 0,
  `a bake started while one runs takes the worker over: the first ends as a cancel ("${tw.first}") and leaves the second its progress bar (${tw.barMid ? "up" : "down"} when the first had ended), the second makes the first bake's bytes, and the bar is down after both`);

const d = r.dlg;
R.is(d.title === "The cockpit, carried out" && d.kinds.join() === "off,off,on*",
  `the dialog opens on its third entry when the body on screen gives no mask to bake — title "${d.title}", kinds ${d.kinds.join(" / ")}`);
R.is(d.ready && /ck_panel_c/.test(d.note1) && /ck_seat_c/.test(d.note1) && /paints on this sheet itself, left as it is/.test(d.note1),
  `the bake finishes and says where the paint came from and what it left: "${d.note1}"`);
R.is(d.builds === 1, `one bake per dialog: choosing the entry again costs no second bake (${d.builds} built)`);
R.is(d.reachShown && /Nothing of the cockpit is within 1 cm/.test(d.note2) && d.off2 && !d.off3 && /within 5 cm/.test(d.note3),
  `the reach re-grades without a bake: at 1 cm "${d.note2}" and the button is off; at 5 cm it is back`);
R.is(d.closed && d.added === 1 && d.name === "From the cockpit" && d.maskUntouched && d.undoDesc === "add layer",
  `Add as layer puts "${d.name}" on top of the sheet as one undo step ("${d.undoDesc}") and leaves the layer's mask alone`);
const lay = d.layer ? unb64(d.layer) : new Uint8Array(0), LW = d.size ? d.size[0] : 0;
const pA = lt(lay, LW, .2, .4), pB = lt(lay, LW, .8, .4), pP = lt(lay, LW, .5, .9), pK = lt(lay, LW, .1, .1);
R.is(LW === TGT_SIDE && lay[pA] === PANEL_BOT[0] && lay[pA+1] === PANEL_BOT[1] && lay[pA+3] === 255 && lay[pB+2] === SEAT[2] && lay[pB+3] === 255 && lay[pP+3] === 0 && lay[pK+3] === 0,
  `the layer holds the carried colour at full alpha inside 70 % of the reach (panel ${lay[pA]},${lay[pA+1]},${lay[pA+2]} @${lay[pA+3]}; seat @${lay[pB+3]}), and nothing where the sheet is passed through (@${lay[pP+3]}) or the cockpit renders the texel (@${lay[pK+3]})`);
R.is(d.afterUndo === 0, `undo takes the layer away again (${d.afterUndo} left)`);
const cm = r.closeMid;
R.is(!cm.connected && !cm.bar && cm.workers === 0 && cm.mode === "unstarted" && cm.live === 0,
  `closing the dialog mid-bake stops its bake: the bar is ${cm.bar ? "still up" : "down"}, ${cm.workers} workers, pool ${cm.mode}`);
R.is(cm.ready && /^Baked at/.test(cm.note), `…and the dialog opened again bakes afresh and is ready to add: "${cm.note}"`);
R.is(!r.rev.threw && r.rev.opened === 0 && /No part of the model uses/.test(r.rev.status),
  r.rev.threw ? "with MaskBake.KINDS.ck deleted the dialog threw: " + r.rev.threw
    : `with the \`ck\` entry of MaskBake.KINDS deleted — the documented reversal — the same state opens nothing and says so, as before 4.45 ("${r.rev.status}")`);
R.is(r.failures.length === 0, r.failures.length ? "reported as failures:\n        " + r.failures.join("\n        ") : "nothing in the run was reported as a failure — the cancels and the states are said, not reported");

const errs = (r.__errs || []).filter(e => !/net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
