// The generated track ribbon (ROADMAP 2.4's oracle for `buildTrackGeometry`).
//
// WHY THIS EXISTS. A War Thunder tank model ships the road wheels and no track: the game builds the
// ribbon at run time, so the app rebuilds it — the convex hull of the wheels on each side, offset
// by their radii, as a two-sided belt. 93 lines of geometry, and until now the only thing that ever
// ran it was `tools/t17_tracks.mjs`, an install-dependent scout that PRINTS what it finds and
// asserts nothing. So the properties a track has are written down here, against wheels whose answer
// is arithmetic:
//
//   * one ribbon per side, named and materialled, and **nothing at all** for a side with fewer
//     than three wheels or for a vehicle whose materials name no track;
//   * the belt **wraps the wheels**: every wheel's centre is at least its own radius from the
//     path, and the path is convex and closed, with a consistent winding;
//   * it is **two-sided**: every quad has its mirror with the normal negated, so the far track
//     does not read as a dark band, and the normals over the whole ribbon sum to zero;
//   * every vertex sits in the belt's own z band, which is the widest wheel plus 2 %;
//   * U spans the belt (0 or 1) and V is arc length over one repeat, so `track.length` is the
//     loop's own perimeter and the last vertex's raw V is that same length;
//   * the two sides are mirror images when the wheels are.
//
// Usage: node tools/t78_tracks.mjs
import fs from "fs";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/").replace(/\/+$/, "");
const src = fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8");
const sectionOf = n => {
  const a = src.indexOf("\n/*==" + n + "==*/"), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("no " + n + " section in the page");
  return src.slice(a + 1, b);
};
// The pure half of game/tracks.js, with the three names it reaches out for stubbed: two are
// string helpers (formats/blk.js, game/registry.js) and the third is the texture index.
const TRK = new Function("descMatName", "unitKey", "GameDB",
  sectionOf("TRACKS").replace(/^"use strict";$/m, "") +
  "\nreturn { hull2d, trackMaterialName, buildTrackGeometry };")(
  m => (typeof m === "string" ? m : m && m.name) || "",
  s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
  { stems: new Map() });

let checks = 0, fails = 0;
const ok = m => { checks++; console.log("  ok   " + m); };
const bad = m => { checks++; fails++; console.log("  FAIL " + m); };
const is = (c, m) => c ? ok(m) : bad(m);

// ---- a synthetic tank: six road wheels a side, a drive sprocket, an idler ----
// Each wheel is a ring of vertices in x/y at a fixed z, which is what the builder measures: it
// takes each `wheel_<side>…` object's bounding box for a centre, a radius and a width.
function tank({ wheelsPerSide = 6, r = .35, z = 1.2, width = .4, y = .4, x0 = -2.4, step = .95 } = {}) {
  const verts = [], objects = [];
  const ring = (name, cx, cy, cz, rad, w) => {
    const first = verts.length;
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      verts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, cz - w / 2]);
      verts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, cz + w / 2]);
    }
    const faces = [];
    for (let i = 0; i < 32; i += 3) faces.push([first + i, first + i + 1, first + (i + 2) % 32]);
    objects.push({ name, groups: [{ faces }] });
  };
  for (const [side, sz] of [["l", z], ["r", -z]]) {
    for (let i = 0; i < wheelsPerSide; i++) ring("wheel_" + side + "_" + (i + 1), x0 + i * step, y, sz, r, width);
  }
  return { verts, objects };
}
const bind = { materials: ["hull_c", "ussr_t_34_track_c"], map: new Map() };

// ---- one ribbon per side, with the track material ----
{
  const out = TRK.buildTrackGeometry(tank(), bind, "ussr_t_34_1941");
  is(out.length === 2, `two ribbons, one a side (${out.length})`);
  is(out.every(o => o.mat === "ussr_t_34_track_c"), `…on the material whose name says track (${out[0] && out[0].mat})`);
  is(out.map(o => o.name).join("|") === "track_l (generated)|track_r (generated)", `…named for the side they are on (${out.map(o => o.name)})`);
  is(out.every(o => o.generated === true && o.track && o.track.vRaw), "…and marked generated, with the raw arc lengths the tiling slider re-scales");

  const L = out[0];
  // every vertex is inside the belt's z band, which is the widest wheel + 2 %
  let zlo = 1e9, zhi = -1e9;
  for (let i = 2; i < L.position.length; i += 3) { zlo = Math.min(zlo, L.position[i]); zhi = Math.max(zhi, L.position[i]); }
  is(Math.abs((zhi - zlo) - .4 * 1.02) < 1e-5, `the belt is as wide as its widest wheel plus 2 % (${(zhi - zlo).toFixed(4)} against ${(.4 * 1.02).toFixed(4)})`);
  is(Math.abs((zhi + zlo) / 2 - 1.2) < 1e-5, `…centred on the wheels' own plane (${((zhi + zlo) / 2).toFixed(4)})`);

  // the path wraps the wheels: no wheel centre is closer to the belt than its own radius
  const pts = [];
  for (let i = 0; i < L.position.length; i += 3) pts.push([L.position[i], L.position[i + 1]]);
  let worst = Infinity;
  for (let k = 0; k < 6; k++) {
    const cx = -2.4 + k * .95, cy = .4;
    let d = Infinity;
    for (const p of pts) d = Math.min(d, Math.hypot(p[0] - cx, p[1] - cy));
    worst = Math.min(worst, d - .35);
  }
  is(worst >= -1e-6, `every wheel is inside the belt — the nearest vertex clears its rim by ${worst.toFixed(4)} m`);

  // two-sided: the normals cancel, and the triangle count is four per hull edge
  let nx = 0, ny = 0;
  for (let i = 0; i < L.normal.length; i += 3) { nx += L.normal[i]; ny += L.normal[i + 1]; }
  is(Math.abs(nx) < 1e-4 && Math.abs(ny) < 1e-4, `the belt is two-sided: its normals sum to zero (${nx.toExponential(1)}, ${ny.toExponential(1)})`);
  is(L.position.length / 3 === L.tris * 3 && L.tris % 4 === 0, `…four triangles per hull edge (${L.tris} triangles over ${L.position.length / 3} vertices)`);
  is(L.normal.length === L.position.length && L.uv.length === L.position.length / 3 * 2, "one normal and one UV per vertex");

  // U spans the belt, V is arc length over one repeat
  let uMin = 9, uMax = -9;
  for (let i = 0; i < L.uv.length; i += 2) { uMin = Math.min(uMin, L.uv[i]); uMax = Math.max(uMax, L.uv[i]); }
  is(uMin === 0 && uMax === 1, `U spans the belt's width exactly (${uMin}…${uMax})`);
  const vMax = Math.max(...L.track.vRaw);
  is(Math.abs(vMax - L.track.length) < 1e-6 || vMax < L.track.length,
    `the raw V is arc length, and the loop is ${L.track.length.toFixed(3)} m round`);
  is(Math.abs(L.uv[1] * L.track.baseRepeat - L.track.vRaw[0]) < 1e-5, "…and V is that length over one repeat of the sheet");
  // the loop is longer than the wheelbase and shorter than its own bounding box's perimeter
  const per = 2 * ((5 * .95 + 2 * .35) + 2 * .35);
  is(L.track.length > 5 * .95 && L.track.length <= per + 1e-6,
    `the loop's length is between the wheelbase and the box round it (${L.track.length.toFixed(3)} m, box ${per.toFixed(3)} m)`);

  // the two sides are mirror images
  const Rr = out[1];
  let zl = 0, zr = 0;
  for (let i = 2; i < L.position.length; i += 3) { zl += L.position[i]; zr += Rr.position[i]; }
  is(Math.abs(zl + zr) < 1e-3 && Math.abs(L.track.length - Rr.track.length) < 1e-6,
    "the two sides are mirror images: the same loop, the opposite side of the hull");
}
// ---- the refusals ----
{
  is(TRK.buildTrackGeometry(tank(), { materials: ["hull_c", "turret_c"], map: new Map() }, "x").length === 0,
    "a vehicle whose materials name no track gets no ribbon");
  is(TRK.buildTrackGeometry(tank(), { materials: ["attch_track_c"], map: new Map() }, "x")[0].mat === "attch_track_c",
    "…and the spare links strapped to the hull are used only when there is nothing better");
  const two = TRK.buildTrackGeometry(tank({ wheelsPerSide: 2 }), bind, "x");
  is(two.length === 0, `a side with two wheels is not a track (${two.length} ribbons)`);
  const three = TRK.buildTrackGeometry(tank({ wheelsPerSide: 3 }), bind, "x");
  is(three.length === 2, "…and three is");
}
// ---- the hull itself ----
{
  const square = [[0, 0], [1, 0], [1, 1], [0, 1], [.5, .5], [.2, .3]];
  const h = TRK.hull2d(square);
  is(h.length === 4, `the convex hull of a square with two points inside it is the square (${h.length} points)`);
  let area = 0;
  for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length]; area += a[0] * b[1] - b[0] * a[1]; }
  is(Math.abs(Math.abs(area / 2) - 1) < 1e-9, `…with the right area (${Math.abs(area / 2)})`);
  is(TRK.hull2d([[0, 0], [1, 1]]).length === 2, "two points are their own hull");
}

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
