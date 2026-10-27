// A part's UV stencil keeps its mirrored half (ROADMAP 4.22).
//
// WHY THIS EXISTS. Reported against the t55e1: "some parts of the body can not be painted from 3d
// view using brushes but pasting images works. Also if you select body — almost half of the body
// surfaces are not painted using fill."
//
// Every one of those three facts is the same cause. Canvas fills with the **nonzero** winding rule,
// and both UV rasterisers accumulated a whole part into one path and filled it once — so two
// overlapping triangles wound opposite ways summed to a winding number of zero and left a hole.
// Mirrored UV shells are the normal way to texture a symmetric vehicle: the left and right of a hull
// share one island and the mirrored side comes out wound the other way, so every texel the two
// halves shared was erased from the stencil. The brush is clipped to that stencil, so it does
// nothing there; Fill uses the same stencil, so it leaves those regions bare; and pasting an image
// works because `drawTexturedTri` clips **one triangle at a time** and never accumulates a shared
// path. The user's own three observations were the diagnosis.
//
// Measured on the reported hull — 38 222 triangles out of the attached .wtproj, 11 811 of them
// mirrored — the part stencil covered **60.24%** of the sheet and covers **73.83%** with the fix.
// A triangle drawn over its own mirror fills **0%**. `evenodd` is not the fix and is worse (46.38%
// on the same hull): overlap is the norm in a UV atlas, not the exception.
//
// The same rasteriser shape appears twice, so both are checked here: `partSetMaskCanvas` (the brush
// stencil, Fill's part scope and a layer's part limit) and `getUVMask` (the export's seam padding,
// where the hole is invisible on screen and permanent in the file).
//
// Usage: node tools/t60_uvmask.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {}, N = 256;
  var slotWas = App.activeSlot, geoWas = App.geomData, matWas = App.matSlot, flipWas = $("optFlipV").checked;
  $("optFlipV").checked = false;
  var flat = function(){ var c = mkCanvas(N, N); var g = ctx2d(c); g.fillStyle = "#404040"; g.fillRect(0, 0, N, N); return c; };
  var mkSlot = function(id){
    var s = { id: id, size: N, layers: [], missing: false };
    s.baseC = flat(); s.composite = flat();
    App.slots.set(id, s);
    return s;
  };
  // A rectangular UV island as two triangles. "ccw" is the winding the mirrored half of a symmetric
  // shell comes out with reversed — which is the whole of this bug.
  var island = function(u0, v0, u1, v1, ccw){
    var a = [u0, v0], b = [u1, v0], c = [u1, v1], d = [u0, v1];
    var t = ccw ? [[a,b,c],[a,c,d]] : [[a,c,b],[a,d,c]];
    var o = [];
    for (var i = 0; i < t.length; i++) for (var k = 0; k < 3; k++) { o.push(t[i][k][0]); o.push(t[i][k][1]); }
    return o;
  };
  var uvOf = function(){
    var o = [];
    for (var i = 0; i < arguments.length; i++) o = o.concat(arguments[i]);
    return new Float32Array(o);
  };
  var cover = function(c){
    if (!c) return 0;
    var d = ctx2d(c).getImageData(0, 0, c.width, c.height).data, n = 0;
    for (var i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
    return n / (c.width * c.height);
  };
  var coverMask = function(m){
    if (!m) return 0;
    var n = 0;
    for (var i = 0; i < m.length; i++) if (m[i]) n++;
    return n / m.length;
  };
  // Stencils only — no dilation — so the numbers can be compared with the area the UVs actually
  // cover rather than with that area plus a grow ring.
  var stencil = function(s, name){ s._partMaskCache = null; return cover(partSetMaskCanvas(s, N, N, [name], 0)); };

  // ---- 1. an island drawn over its own mirror ----
  // 0.6 x 0.6 of the sheet = 0.36. Before the fix the mirrored copy cancelled it exactly: 0.
  var A = mkSlot("t60a");
  App.matSlot = new Map([["m", "t60a"]]);
  App.geomData = [
    { name: "plain",  mat: "m", uv: uvOf(island(.2, .2, .8, .8, true)) },
    { name: "mirror", mat: "m", uv: uvOf(island(.2, .2, .8, .8, true), island(.2, .2, .8, .8, false)) },
  ];
  App.activeSlot = A;
  out.plain = stencil(A, "plain");
  out.mirror = stencil(A, "mirror");
  out.want = .36;

  // ---- 2. a mirrored shell that only PARTLY overlaps, so the hole is a sub-region ----
  // [.2,.8]x[.2,.8] plus a mirrored [.5,1]x[.2,.8]: the union is [.2,1]x[.2,.8] = 0.48, and the
  // overlap that used to be erased is [.5,.8]x[.2,.8] = 0.18, leaving 0.30.
  App.geomData = [
    { name: "half", mat: "m", uv: uvOf(island(.2, .2, .8, .8, true), island(.5, .2, 1, .8, false)) },
  ];
  out.half = stencil(A, "half");
  out.halfUnion = .48;
  out.halfWas = .30;

  // ---- 3. the export's seam-padding mask, which has the same shape and the same bug ----
  var B = mkSlot("t60b");
  App.matSlot = new Map([["m2", "t60b"]]);
  App.geomData = [{ name: "hull", mat: "m2", uv: uvOf(island(.2, .2, .8, .8, true), island(.2, .2, .8, .8, false)) }];
  App.activeSlot = B;
  B._uvMasks = null;
  out.padMask = coverMask(getUVMask(B, N, N));

  // ---- 4. and a part with no mirrored triangles at all is untouched ----
  var C = mkSlot("t60c");
  App.matSlot = new Map([["m3", "t60c"]]);
  App.geomData = [{ name: "one", mat: "m3", uv: uvOf(island(.25, .25, .75, .75, true)) }];
  App.activeSlot = C;
  out.unmirrored = stencil(C, "one");
  out.unmirroredWant = .25;

  // ---- 5. the byte rasteriser agrees with the canvas path it replaced (ROADMAP 4.23(b)) ----
  // The reference is built HERE rather than called out of the app, because the app no longer
  // contains it: this is the old shape — accumulate every triangle into one path, fill it, then
  // drive the antialiased edge texels to opaque with three self-composites. Keeping it in the test
  // is what makes "the new rasteriser agrees with the old one" a permanent property instead of a
  // migration note nobody can re-check. 4.22's winding reversal is included, or the reference
  // cancels its own mirrored half and the comparison is against a known-broken picture.
  var canvasRef = function(uv, W, H){
    var c = mkCanvas(W, H), g = ctx2d(c);
    g.fillStyle = "#fff";
    g.beginPath();
    for (var t = 0; t < uv.length / 6; t++) {
      var o = t * 6;
      var ax = uv[o] * W,   ay = (1 - uv[o+1]) * H;
      var bx = uv[o+2] * W, by = (1 - uv[o+3]) * H;
      var cx = uv[o+4] * W, cy = (1 - uv[o+5]) * H;
      g.moveTo(ax, ay);
      if ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay) < 0) { g.lineTo(cx, cy); g.lineTo(bx, by); }
      else { g.lineTo(bx, by); g.lineTo(cx, cy); }
      g.closePath();
    }
    g.fill();
    for (var i = 0; i < 3; i++) g.drawImage(c, 0, 0);
    var d = ctx2d(c).getImageData(0, 0, W, H).data, m = new Uint8Array(W * H);
    for (var j = 0; j < W * H; j++) m[j] = d[j*4+3] > 128 ? 1 : 0;
    return m;
  };
  var rasterOf = function(uv, W, H){
    var m = new Uint8Array(W * H);
    rasterUVTriangles(m, uv, W, H, false, 1);
    return m;
  };
  // Every texel where the two disagree has to be within one texel of a boundary OF THE REFERENCE.
  // That is what "agrees to within a texel" can mean for a flat-coverage rasteriser measured
  // against an antialiased-then-hardened fill: the two cannot agree ON an edge, by construction,
  // and a disagreement anywhere else is a real difference in shape.
  // Two properties, and they are not the same one.
  //   never TIGHTER than the reference — the raster must cover every texel the old path did,
  //     because padSeams overwrites anything the mask calls outside;
  //   and where it is wider, only along the boundary — measured as the Chebyshev distance from
  //     each disagreeing texel to the nearest place the reference itself changes value.
  // A conservative test reaches further than one texel at an ACUTE CORNER, where two edges' slack
  // adds up, so the distance is reported rather than assumed to be 1.
  var compare = function(uv, W, H){
    var a = canvasRef(uv, W, H), b = rasterOf(uv, W, H);
    var isEdge = function(x, y){
      var i = y * W + x;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) return true;
        if (a[ny * W + nx] !== a[i]) return true;
      }
      return false;
    };
    var diff = 0, onlyA = 0, onlyB = 0, far = 0;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var i = y * W + x;
      if (a[i] === b[i]) continue;
      diff++;
      if (a[i]) onlyA++; else onlyB++;
      // smallest r for which some texel within r of this one sits on a reference boundary
      var r = 0;
      for (; r <= 6; r++) {
        var found = false;
        for (var dy2 = -r; dy2 <= r && !found; dy2++) for (var dx2 = -r; dx2 <= r; dx2++) {
          if (Math.max(Math.abs(dx2), Math.abs(dy2)) !== r) continue;
          var nx2 = x + dx2, ny2 = y + dy2;
          if (nx2 < 0 || ny2 < 0 || nx2 >= W || ny2 >= H) { found = true; break; }
          if (isEdge(nx2, ny2)) { found = true; break; }
        }
        if (found) break;
      }
      if (r > far) far = r;
    }
    return { diff: diff, onlyA: onlyA, onlyB: onlyB, far: far, of: W * H };
  };

  out.cmpPlain  = compare(uvOf(island(.2, .2, .8, .8, true)), N, N);
  out.cmpMirror = compare(uvOf(island(.2, .2, .8, .8, true), island(.2, .2, .8, .8, false)), N, N);
  // a diamond, so the comparison is not made only on axis-aligned edges
  out.cmpDiag = compare(new Float32Array([.1,.5, .5,.1, .9,.5,  .1,.5, .9,.5, .5,.9]), N, N);

  // ---- 6. a sliver thinner than a texel is still rasterised ----
  // This is the OTHER job hardenMask's three self-composites were doing, in its own words: "which
  // is also what rescues sliver triangles thinner than a texel". A centre-test fill alone drops one
  // outright — no texel centre is inside it — so the rasteriser walks the three edges as well, and
  // this is the assertion that keeps that walk honest.
  var sliverH = new Float32Array([.1, .5, .9, .5, .9, .5001]);
  var sliverV = new Float32Array([.5, .1, .5, .9, .5001, .9]);
  var sliverD = new Float32Array([.1, .1, .9, .9, .9001, .9]);
  var countOf = function(uv){
    var m = rasterOf(uv, N, N), n = 0;
    for (var i = 0; i < m.length; i++) if (m[i]) n++;
    return n;
  };
  out.sliver = { h: countOf(sliverH), v: countOf(sliverV), d: countOf(sliverD), want: N * .8 };

  // ---- 6b. tiled UVs reach the sheet at all (ROADMAP 4.23(a)) ----
  // gun_barrel on the t55e1 runs u from -0.001 to 6.353 — a rifled barrel textured by repeating one
  // strip six times. Every clamp in the rasteriser is against the sheet, so five of those six
  // repeats were outside it and invisible to every tool: a stroke on them landed nowhere and a part
  // selection that included them under-covered. The sheet is the unit square, so a tiled part paints
  // through u mod 1 — each triangle is rasterised once per tile it touches, translated by a whole
  // sheet, and the bounding-box clamp does the clipping.
  var base = island(.1, .1, .4, .9, true);
  var shift = function(uv, du, dv){ var o = uv.slice(); for (var i = 0; i < o.length; i += 2) { o[i] += du; o[i+1] += dv; } return o; };
  out.tile = {};
  out.tile.inside = countOf(uvOf(base));
  // The SAME island, six tiles along. Every texel has to be the same texel.
  var farRaster = rasterOf(uvOf(shift(base, 6, 0)), N, N);
  var nearRaster = rasterOf(uvOf(base), N, N);
  out.tile.far = 0; out.tile.diff = 0;
  for (var i = 0; i < farRaster.length; i++) {
    if (farRaster[i]) out.tile.far++;
    if (!!farRaster[i] !== !!nearRaster[i]) out.tile.diff++;
  }
  // ...and negative u, which is where that barrel actually starts.
  out.tile.neg = countOf(uvOf(shift(base, -1, 0)));
  // A quad straddling u = 1: 0.6 -> 1.6 must come out as 0.6..1 plus 0..0.6, i.e. the union of two
  // bands and not one smear across the middle. Read as a row of the sheet rather than as a count,
  // because a fold would have the same area and the wrong place.
  var strad = rasterOf(uvOf(island(.6, .2, 1.6, .8, true)), N, N);
  var rowAt = function(m, y){ var n = 0; for (var x = 0; x < N; x++) if (m[y * N + x]) n++; return n; };
  out.tile.strad = { covered: rowAt(strad, N / 2), width: N,
                     leftEdge: !!strad[(N / 2) * N + 2], gap: !!strad[(N / 2) * N + Math.round(N * .58)] };
  // A runaway UV does not rasterise a million copies of one triangle.
  var t0 = performance.now();
  countOf(uvOf(island(0, .1, 5000, .9, true)));
  out.tile.runawayMs = Math.round(performance.now() - t0);

  // ---- 7. UV islands: the connected shells the same pass now also yields (ROADMAP 4.24) ----
  // Four parts over one sheet, arranged so every case the feature has to get right is present:
  //   hullL   its own shell, touching nothing
  //   hullR   one shell drawn over its own mirror — the 4.22 shape, and still ONE island
  //   turret  a shell that
  //   skirt     shares its bottom edge, so the two parts are one island
  // Expected: three islands, not four and not five.
  var D = mkSlot("t60d");
  App.matSlot = new Map([["m4", "t60d"]]);
  App.geomData = [
    { name: "hullL",  mat: "m4", uv: uvOf(island(.05, .05, .45, .45, true)) },
    { name: "hullR",  mat: "m4", uv: uvOf(island(.55, .05, .95, .45, true), island(.55, .05, .95, .45, false)) },
    { name: "turret", mat: "m4", uv: uvOf(island(.05, .55, .45, .95, true)) },
    { name: "skirt",  mat: "m4", uv: uvOf(island(.05, .95, .45, 1, true)) },
  ];
  App.activeSlot = D;
  D._uvIslands = null; D._partMaskCache = null;
  var I = UVIslands.of(D);
  out.isl = { count: I.count, tris: I.comp.length, boundary: I.boundary.length / 4 };
  // A click, in sheet texels — the same coordinates the 2-D pointer gives and a 3-D hit converts to.
  var at = function(u, v){ return UVIslands.at(D, u * N, (1 - v) * N); };
  out.isl.hitHullL = at(.25, .25);
  out.isl.hitHullR = at(.75, .25);
  out.isl.hitTurret = at(.25, .75);
  out.isl.hitSkirt = at(.25, .975);
  out.isl.hitGutter = at(.5, .5);
  // Stable across a rebuild: same components, same ids, from the same mesh.
  D._uvIslands = null;
  var I2 = UVIslands.of(D);
  out.isl.recount = I2.count;
  out.isl.resame = at(.25, .25) === out.isl.hitHullL && at(.75, .25) === out.isl.hitHullR &&
                   at(.25, .75) === out.isl.hitTurret;
  // Every component rasterises to something. A component that comes out empty is a quantisation bug
  // — the decomposition found a shell the rasteriser cannot reach — and it would show up as an
  // island you can click and then not paint.
  out.isl.empty = [];
  out.isl.areas = [];
  for (var ci = 0; ci < I.count; ci++) {
    var cv = cover(UVIslands.stencil(D, N, N, new Set([ci])));
    out.isl.areas.push(+cv.toFixed(4));
    if (!(cv > 0)) out.isl.empty.push(ci);
  }
  // A part whose shells are its own: its islands unioned ARE its stencil, to the texel.
  var islandsOfPart = function(name){
    var got = new Set();
    for (var k = 0; k < I.chunks.length; k++) {
      var ch = I.chunks[k];
      if (ch.gd.name !== name) continue;
      for (var t = 0; t < ch.n; t++) got.add(I.comp[ch.off + t]);
    }
    return got;
  };
  out.isl.hullLPart = cover(partSetMaskCanvas(D, N, N, ["hullL"]));
  out.isl.hullLIsl = cover(UVIslands.stencil(D, N, N, islandsOfPart("hullL")));
  // And a shared shell: the island is BIGGER than either part's stencil, because it is both of them.
  // That inequality is the whole reason the feature exists — a part is not a shell.
  out.isl.turretPart = cover(partSetMaskCanvas(D, N, N, ["turret"]));
  out.isl.turretIsl = cover(UVIslands.stencil(D, N, N, islandsOfPart("turret")));
  out.isl.sharedIds = islandsOfPart("turret").size === 1 &&
    [...islandsOfPart("skirt")][0] === [...islandsOfPart("turret")][0];
  // The box a selection reports has to CONTAIN the stencil it bounds, dilation and all.
  var bx = UVIslands.bounds(D, islandsOfPart("hullL"));
  out.isl.box = bx;
  out.isl.boxHolds = !!bx && bx.x <= .05 * N && bx.y <= .55 * N &&
    bx.x + bx.w >= .45 * N && bx.y + bx.h >= .95 * N;
  out.isl.parts = [...UVIslands.parts(D, islandsOfPart("turret"))].sort().join(",");

  App.slots.delete("t60d");
  App.slots.delete("t60a"); App.slots.delete("t60b"); App.slots.delete("t60c");
  App.activeSlot = slotWas; App.geomData = geoWas; App.matSlot = matWas;
  $("optFlipV").checked = flipWas;
  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY), keep: argv.includes("--keep") });
if (!r.ok) { console.log("FAILED to evaluate: " + JSON.stringify(r).slice(0, 400)); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("threw in page:\n" + o.__threw); process.exit(1); }
const pct = v => (v * 100).toFixed(1) + "%";
const near = (a, b) => Math.abs(a - b) < .01;

console.log("=== a part's stencil keeps its mirrored half (4.22) ===");
console.log(`   one island ${pct(o.plain)} · the same island over its own mirror ${pct(o.mirror)} · wanted ${pct(o.want)}`);
R.is(near(o.plain, o.want),
  `an ordinary UV island rasterises to the area it covers (${pct(o.plain)} of the sheet, wanted ${pct(o.want)})`);
R.is(near(o.mirror, o.want),
  `and drawing it a second time MIRRORED does not erase it (${pct(o.mirror)}) — canvas fills nonzero, so two overlapping triangles wound opposite ways sum to zero and leave a hole. This read 0% before: the brush did nothing there, Fill left it bare, and pasting an image worked, because that path clips one triangle at a time`);
R.is(near(o.half, o.halfUnion),
  `a mirrored shell that only partly overlaps gives the UNION (${pct(o.half)}, wanted ${pct(o.halfUnion)}) rather than the union minus the overlap (${pct(o.halfWas)}) — the hole is wherever two shells share texels, which on a symmetric hull is most of it`);
R.is(near(o.padMask, o.want),
  `the export's seam-padding mask has the same shape and had the same hole (${pct(o.padMask)}, wanted ${pct(o.want)}) — invisible on screen and permanent in the file`);
R.is(near(o.unmirrored, o.unmirroredWant),
  `and a part with no mirrored triangles is exactly what it was (${pct(o.unmirrored)}, wanted ${pct(o.unmirroredWant)})`);

console.log("\n=== the byte rasteriser covers everything the canvas path it replaced did (4.23(b)) ===");
for (const [name, c] of [["a plain island", o.cmpPlain], ["one over its own mirror", o.cmpMirror], ["a diamond", o.cmpDiag]]) {
  console.log("   " + name.padEnd(24) + " differ " + c.diff + "/" + c.of +
    " · only-canvas " + c.onlyA + " · only-raster " + c.onlyB + " · furthest from a boundary " + c.far);
  R.is(c.onlyA === 0,
    name + ": the raster covers every texel the canvas path did (" + c.onlyA + " missing) — tighter is the direction that damages a file, because padSeams OVERWRITES any texel the mask calls outside with a neighbour's colour");
  R.is(c.far <= 2,
    name + ": and where it is wider it is only along the boundary (furthest " + c.far + " texels, allowing 2 — a conservative test reaches past one texel at an acute corner, where two edges' slack adds up)");
}
console.log("\n=== a sliver thinner than a texel is still rasterised ===");
console.log("   horizontal " + o.sliver.h + " texels · vertical " + o.sliver.v + " · diagonal " + o.sliver.d +
  " · a full span would be ~" + Math.round(o.sliver.want));
for (const [name, n] of [["horizontal", o.sliver.h], ["vertical", o.sliver.v], ["diagonal", o.sliver.d]]) {
  R.is(n >= o.sliver.want * .9,
    "a " + name + " sliver marks the texels it crosses (" + n + ", wanted ~" + Math.round(o.sliver.want) +
    ") — it contains no texel CENTRE, so a fill alone drops it. That is the job hardenMask's three self-composites used to do and the rasteriser's edge walk does now");
}

console.log("\n=== the same pass yields the islands a click selects (4.24) ===");
const I = o.isl;
console.log(`   ${I.tris} triangles over 4 parts → ${I.count} islands, ${I.boundary} boundary edges` +
  `  ·  areas ${I.areas.map(a => pct(a)).join(" / ")}`);
R.is(I.count === 3,
  `four parts, three islands (${I.count}) — hullR's shell drawn over its own MIRROR is one island, and turret+skirt share an edge so they are one island across two parts`);
R.is(I.recount === I.count && I.resame,
  `the decomposition is stable across a rebuild (${I.recount} islands, same ids under the same points) — an island has no name, so a click has to land on the same component every time or nothing about it is reproducible`);
R.is(I.hitHullL && I.hitHullR && I.hitTurret && I.hitHullL !== I.hitHullR && I.hitHullL !== I.hitTurret,
  `a click lands on the island under it, and three different shells give three different answers (${I.hitHullL} / ${I.hitHullR} / ${I.hitTurret})`);
R.is(I.hitSkirt === I.hitTurret,
  `clicking the skirt selects the shell it shares with the turret (${I.hitSkirt}) — one shell, two parts, which is the case a part selection cannot express`);
R.is(I.hitGutter === 0, `and the gutter between the shells is not an island (${I.hitGutter})`);
R.is(I.empty.length === 0,
  `every component rasterises to something (${I.empty.length} empty) — an empty one is a quantisation bug, and it would read as an island you can click and then not paint`);
R.is(near(I.hullLPart, I.hullLIsl),
  `a part whose shells are its own: its islands unioned ARE its stencil (${pct(I.hullLIsl)} vs ${pct(I.hullLPart)})`);
R.is(I.turretIsl > I.turretPart + .005 && I.sharedIds,
  `and a SHARED shell is bigger than either part's stencil (${pct(I.turretIsl)} vs ${pct(I.turretPart)}) — that inequality is the whole reason an island is not a part`);
R.is(I.parts === "skirt,turret", `it says which parts it spans (${I.parts}), because a mirrored or shared shell paints somewhere the click did not point`);
R.is(I.boxHolds, `the box a selection reports contains the stencil it bounds, dilation and all (${I.box ? I.box.x + "," + I.box.y + " " + I.box.w + "×" + I.box.h : "null"})`);
R.is(I.boundary > 0, `and the outline the 2-D overlay draws comes out of the same pass (${I.boundary} boundary edges), so what is drawn and what is selected cannot be two decompositions`);

console.log("\n=== tiled UVs reach the sheet (4.23(a)) ===");
const TI = o.tile;
console.log(`   inside ${TI.inside} · six tiles along ${TI.far} (${TI.diff} texels differ) · negative u ${TI.neg} · straddling row ${TI.strad.covered}/${TI.strad.width}, runaway ${TI.runawayMs} ms`);
// Within a texel, not byte-identical, and the difference is float32 rather than the wrap: a UV array
// is Float32Array in the app as well as here, so `0.1 + 6` is not `0.1` plus six sheets — 6.1f
// times 256 lands 0.0004 texels off 6·256 + 0.1·256, which is enough to put one boundary texel on
// the other side of the conservative test. Asserting equality would be asserting that float32
// addition is exact.
R.is(TI.inside > 100 && Math.abs(TI.far - TI.inside) <= 2 && TI.diff <= 2,
  `an island six tiles along the u axis rasterises to the same texels as the same island at u 0…1 (${TI.far} vs ${TI.inside}, ${TI.diff} differ, float32) — before this it produced NOTHING, which is what made five of a t55e1 gun barrel's six repeats invisible to every tool`);
R.is(TI.neg === TI.inside, `and so does one at negative u (${TI.neg}), which is where that barrel actually starts (-0.001)`);
R.is(TI.strad.covered === TI.strad.width && TI.strad.leftEdge && TI.strad.gap,
  `a quad straddling u = 1 comes out as both bands rather than one fold (${TI.strad.covered} of ${TI.strad.width} texels across the middle row, left edge ${TI.strad.leftEdge}) — a fold would cover the same AREA in the wrong place, so this is read as a row and not as a count`);
R.is(TI.runawayMs < 2000, `and a UV running to u = 5000 does not rasterise five thousand copies of one triangle (${TI.runawayMs} ms) — the tile count is capped, because that is a broken UV rather than a tiled one`);

const errs = (o.__errs || []);
R.is(errs.length === 0, errs.length ? "uncaught errors: " + errs.join(" | ") : "no uncaught errors during the run");
R.finish();
