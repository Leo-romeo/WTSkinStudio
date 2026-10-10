// Symmetry on the SHEET — the mirror a user could not find a working one of (ROADMAP 6.2).
//
// WHY THIS EXISTS. `symEnabled()` used to be read in `editor/paint3d.js` and nowhere else, so a
// stroke drawn in the 2-D view was never mirrored — and the sheet mirrors *by accident* on some
// parts and not on others (242 of 435 side-tagged pairs over 14 vehicles paint both sides from the
// same texels, `tools/mirror_uv.mjs`), which is what "mirror is a bit broken" looks like from the
// user's seat. `Mirror` closes it by asking the model rather than the sheet: reflect a texel's
// baked position in the mirror plane, and find the texel that is at THAT place.
//
// Every property below is arithmetic on a synthetic bake this file lays out itself — two square
// patches of a "vehicle" at z = ±d, mapped to two rectangles of one sheet — so nothing here needs
// a game install, a GPU or a model:
//
//   * a texel on one patch maps to the texel of its reflection on the other, EXACTLY;
//   * a texel whose reflection is not on the sheet maps to nothing, rather than to the nearest
//     thing that happens to be there — the limit is 3 of this sheet's own texels, measured from
//     the bake, because a sheet's texel is 9 mm on one vehicle and 90 mm on another;
//   * the match survives a competing region 20 mm away: the index is strided, so the nearest
//     SAMPLE can stand for the wrong surface, and refining only the best one returned that wrong
//     surface on the F-4E's wing. With KEEP at 1 the assertion below fails, which is the proof
//     that the multi-candidate refine is what fixes it and not something else;
//   * the plane offset moves the answer, and an axis with no span refuses rather than divides by
//     zero;
//   * a stroke stamps its mirror on channel 1 and reports what it could not mirror ONCE.
//
// Usage: node tools/t83_mirror.mjs
import fs from "fs";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/").replace(/\/+$/, "");
const src = fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8");
const sectionOf = n => {
  const a = src.indexOf("\n/*==" + n + "==*/"), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("no " + n + " section in the page");
  return src.slice(a + 1, b);
};

let checks = 0, fails = 0;
const ok = m => { checks++; console.log("  ok   " + m); };
const bad = m => { checks++; fails++; console.log("  FAIL " + m); };
const is = (c, m) => c ? ok(m) : bad(m);

// ---- the page's own globals, stubbed to exactly what MIRROR reads ----
const G = {
  symAxis: "z", symC: 0,
  stamps: [], statuses: [],
};
const env = {
  symPlane: () => ({ a: G.symAxis, c: G.symC }),
  symEnabled: () => true,
  App: { activeSlot: null },
  Bake: { cached: slot => slot && slot._bake ? slot._bake.pos : null, key: () => "k" },
  GradFill: { bakeable: () => false },
  Prog: { active: false },
  Cancelled: class Cancelled extends Error {},
  reportFailure: () => {},
  setStatus: (m, k) => G.statuses.push([m, k]),
  stampAt: (x, y, ch, opt) => G.stamps.push({ x, y, ch, opt }),
  stroke: {},
};
const Mirror = new Function(...Object.keys(env),
  sectionOf("MIRROR").replace(/^"use strict";$/m, "") + "\nreturn Mirror;")(...Object.values(env));

// ---- a synthetic bake: two patches of one vehicle, on two rectangles of one sheet ----
// The box is 8 m on every axis, so one index cell is 0.125 m; a patch is 1 m across over 64 texels,
// so a texel is 15.6 mm and four of them (the stride) is 62.5 mm — half a cell, which is the
// relationship the index needs and is asserted below rather than assumed.
const W = 128, H = 128, D = 0.5;                      // the two patches sit at z = ±D
const BB = { x0: -4, x1: 4, y0: -4, y1: 4, z0: -4, z1: 4 };
const enc = (v, lo, hi) => Math.round((v - lo) / (hi - lo) * 65535);
function makeBake(extra){
  const pos = new Uint16Array(W * H * 3), has = new Uint8Array(W * H), cov = new Uint8Array(W * H);
  const put = (x, y, wx, wy, wz) => {
    const i = y * W + x;
    pos[i * 3] = enc(wx, BB.x0, BB.x1); pos[i * 3 + 1] = enc(wy, BB.y0, BB.y1); pos[i * 3 + 2] = enc(wz, BB.z0, BB.z1);
    has[i] = cov[i] = 1;
  };
  // patch A: sheet x 0…63 → world x −0.5…0.5 at z = +D; patch B: sheet x 64…127, same, z = −D
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const wx = -0.5 + x / 64, wy = -0.5 + y / 64;
    put(x, y, wx, wy, D);
    put(x + 64, y, wx, wy, -D);
  }
  if (extra) extra(put);
  return { kind: "pos", w: W, h: H, pos, has, cov, bb: BB, key: "k", ser: 1 };
}
const slotOf = b => ({ id: "t83", composite: { width: W, height: H }, _bake: { pos: b } });

{
  const b = makeBake();
  const s = slotOf(b);
  env.App.activeSlot = s;
  const cell = (BB.z1 - BB.z0) / Mirror.G, stride = Mirror.STRIDE * (1 / 64);
  is(cell > stride * 1.5, `the fixture is laid out so the index cell (${cell} m) is bigger than its stride (${stride.toFixed(4)} m) — otherwise nothing below means anything`);

  // ---- the reflection is exact ----
  let exact = 0, tried = 0, worst = 0;
  for (let y = 2; y < 64; y += 7) for (let x = 2; x < 64; x += 7) {
    tried++;
    const q = Mirror.texel(s, x, y);
    if (!q) continue;
    if (q.x === x + 64 && q.y === y) exact++;
    worst = Math.max(worst, q.d);
  }
  is(exact === tried, `every texel of one patch maps to its own reflection on the other (${exact}/${tried})`);
  is(worst < 1e-3, `…with no error at all to find (worst ${(worst * 1000).toFixed(3)} mm)`);
  // and back again, which is what makes it a mirror rather than a shift
  const back = Mirror.texel(s, 70, 30);
  is(back && back.x === 6 && back.y === 30, `…and the same map read from the other side (${back ? back.x + "," + back.y : "nothing"})`);

  // ---- the size of a texel, measured off the bake ----
  const t = Mirror.texelSize(b, 30 * W + 30);
  is(Math.abs(t - 1 / 64) < 1e-4, `one texel of this sheet is ${(t * 1000).toFixed(2)} mm on the vehicle, read from the bake`);
  is(Math.abs(Mirror.limit(b, 30 * W + 30) - 3 / 64) < 1e-4, "…and the match limit is three of them");

  // ---- the plane is the plane ----
  G.symC = 0.25;                                   // halfway between the patches is no longer z = 0
  is(Mirror.texel(s, 10, 10) === null, "moving the plane off the middle leaves the reflection nowhere, and it says so");
  G.symC = 0;
  is(Mirror.texel(s, 10, 10) !== null, "…and putting it back finds it again");
  // The fixture is symmetric about all three axes, so a WRONG axis proves nothing on it. What does
  // is an axis the box has no span on: a plane with nothing to reflect across, refused rather than
  // divided by.
  const flat = { ...b, bb: { ...BB, z0: 1, z1: 1 } };
  is(Mirror.planeOf(flat) === null, "an axis the model has no extent on is refused rather than divided by");
  is(Mirror.texel(slotOf(flat), 10, 10) === null, "…and no texel of it mirrors to anything");
}

// ---- a texel with no partner ----
{
  // one extra patch, on nothing's far side: a fin on the centreline, at z = +D but with no twin
  const b = makeBake(put => { for (let y = 70; y < 90; y++) for (let x = 70; x < 90; x++) put(x, y, 2 + (x - 70) / 64, (y - 70) / 64, D); });
  const s = slotOf(b);
  env.App.activeSlot = s;
  is(Mirror.texel(s, 80, 80) === null, "a patch whose reflection is on no texel of this sheet maps to nothing");
  is(Mirror.texel(s, 10, 10) !== null, "…while the rest of the sheet still mirrors");
  is(Mirror.texel(s, 100, 100) === null, "a texel that is not on the model at all maps to nothing");
}

// ---- the competing region: the bug the F-4E's wing found ----
{
  // A decoy patch 20 mm from where texel (34, 30)'s reflection really is — inside the limit, so the
  // limit alone cannot save it — and laid so that ITS sample sits on the index stride while the true
  // partner's does not. That is the whole shape of the failure: the nearest strided SAMPLE stood for
  // the wrong surface.
  const DEC = 0.02;
  const b = makeBake(put => {
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++)
      put(x, y + 64, -0.5 + x / 64, -0.5 + y / 64 + DEC, -D);       // the decoy, 20 mm up in y
  });
  const s = slotOf(b);
  env.App.activeSlot = s;
  const sx = 34, sy = 30;                                            // 34 ≡ 2 (mod 4): off the stride
  const want = { x: sx + 64, y: sy };
  const got = Mirror.texel(s, sx, sy);
  is(got && got.x === want.x && got.y === want.y,
    `with a decoy ${DEC * 1000} mm away the true reflection still wins (${got ? got.x + "," + got.y : "nothing"}, wanted ${want.x},${want.y})`);
  is(got && got.d < 1e-3, `…and it is the exact one, not the near one (${got ? (got.d * 1000).toFixed(2) : "-"} mm)`);
  // …and the proof that the multi-candidate refine is what does it
  const keep = Mirror.KEEP;
  Mirror.KEEP = 1;
  const one = Mirror.texel(s, sx, sy);
  Mirror.KEEP = keep;
  is(one && !(one.x === want.x && one.y === want.y),
    `refining only the best sample returns the decoy instead (${one ? one.x + "," + one.y : "nothing"}) — which is what this check would otherwise not be testing`);
}

// ---- the stroke ----
{
  const b = makeBake();
  const s = slotOf(b);
  env.App.activeSlot = s;
  G.stamps.length = 0; G.statuses.length = 0;
  Mirror.begin();
  for (let k = 0; k < 5; k++) Mirror.stamp({ x: 10 + k, y: 20 }, null);
  is(G.stamps.length === 5, `a five-dab stroke stamps five mirrored dabs (${G.stamps.length})`);
  is(G.stamps.every(t => t.ch === 1), "…on stroke channel 1, the channel the 3-D mirror uses");
  is(G.stamps.every((t, k) => t.x === 74 + k && t.y === 20), "…each at its own reflection");
  is(G.stamps[0].opt && G.stamps[0].opt.jump === true, "…the first one as a jump, since there is no previous mirrored point to draw from");
  is(!G.stamps[1].opt, "…and the rest interpolated from it, because the mirror walked beside the pointer");
  Mirror.end();
  is(G.statuses.length === 0, "a stroke that mirrored everything says nothing");

  // A stroke that crosses onto a part whose twin is somewhere else entirely: the pointer moves ONE
  // texel and the copy moves half the sheet, which is the case the copy must jump for rather than
  // draw a line to. Patch C sits directly under patch A on the sheet and its twin is in the far
  // corner, so texels (4, 63) and (4, 64) are neighbours whose reflections are not.
  const b3 = makeBake(put => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      put(x, y + 64, 1 + x / 64, -0.5 + y / 64, D);
      put(x + 100, y + 100, 1 + x / 64, -0.5 + y / 64, -D);
    }
  });
  const s3 = slotOf(b3);
  env.App.activeSlot = s3;
  G.stamps.length = 0;
  Mirror.begin();
  Mirror.stamp({ x: 4, y: 62 }, null);             // patch A  → mirror at (68, 62)
  Mirror.stamp({ x: 4, y: 63 }, null);             // still A  → mirror at (68, 63), one texel on
  Mirror.stamp({ x: 4, y: 64 }, null);             // patch C  → mirror at (104, 100), half a sheet
  is(G.stamps.length === 3 && G.stamps[2].x === 104 && G.stamps[2].y === 100,
    `a stroke that crosses to a part whose twin is elsewhere follows it (${G.stamps[2].x},${G.stamps[2].y})`);
  is(!G.stamps[1].opt, "…the step before it interpolated, because the copy was walking beside the pointer");
  is(G.stamps[2].opt && G.stamps[2].opt.jump === true,
    "…and that one a JUMP, so the copy does not draw a line clean across the sheet to get there");

  // what it could not mirror is said once, at the end, and not per dab
  const b4 = makeBake(put => { for (let y = 70; y < 90; y++) for (let x = 70; x < 90; x++) put(x, y, 2 + (x - 70) / 64, (y - 70) / 64, D); });
  const s4 = slotOf(b4);
  env.App.activeSlot = s4;
  G.stamps.length = 0; G.statuses.length = 0;
  Mirror.begin();
  for (let k = 0; k < 6; k++) Mirror.stamp({ x: 72 + k, y: 80 }, null);
  is(G.stamps.length === 0 && G.statuses.length === 0, "six dabs with no reflection stamp nothing, and say nothing while the stroke is running");
  Mirror.end();
  is(G.statuses.length === 1 && /isn't on this sheet/.test(G.statuses[0][0]),
    `…and one sentence at the end of it (“${G.statuses[0] ? G.statuses[0][0] : ""}”)`);
  // The 2-D view calls `end` on every pointerup — a pan, a marquee drag — not only after a stroke.
  Mirror.end();
  is(G.statuses.length === 1, `…said once: the next pointerup, with no stroke in it, does not say it again (${G.statuses.length} sentences)`);

  // A Shift+click line is continuous by request, so its copy is too — from the last copy's end.
  const b5 = makeBake();
  env.App.activeSlot = slotOf(b5);
  G.stamps.length = 0;
  Mirror.begin();
  env.stroke.lasts = [{ x: 4, y: 20 }, { x: 68, y: 20 }];
  Mirror.stamp({ x: 30, y: 20 }, { line: true });
  is(G.stamps.length === 1 && G.stamps[0].opt && G.stamps[0].opt.line === true && !G.stamps[0].opt.jump,
    `a mirrored Shift+click line is drawn as a line from the last mirrored point, not a dab at its end (${JSON.stringify(G.stamps[0] && G.stamps[0].opt)})`);
  env.stroke.lasts = [{ x: 4, y: 20 }, null];
  Mirror.begin();
  Mirror.stamp({ x: 30, y: 20 }, { line: true });
  is(G.stamps[1] && G.stamps[1].opt && G.stamps[1].opt.jump === true,
    "…and with no mirrored point to run from, it starts with a dab");
  delete env.stroke.lasts;
}

// ---- the index is built once ----
{
  const b = makeBake();
  const s = slotOf(b);
  env.App.activeSlot = s;
  const first = Mirror.index(b);
  Mirror.texel(s, 10, 10);
  is(Mirror.index(b) === first, "the index is built once per bake and kept on it");
  is(first.n === Math.ceil(64 / Mirror.STRIDE) * Math.ceil(64 / Mirror.STRIDE) * 2,
    `…over every ${Mirror.STRIDE}th texel of the covered sheet (${first.n} points)`);
}

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
