// Brush tips and dynamics (ROADMAP 4.50 (10)).
//
// WHY THIS EXISTS. Every part of this is wrong in a way that still paints. A tip turned by its Angle
// whose corners fall outside the undo tiles is a dab cut square at a tile edge; a scatter that moves
// the walk rather than the dab is a stroke that wanders off the line; a jitter that draws from the
// stream when it is off makes a plain stroke a different stroke; a tip that loses its library entry
// is a brush that quietly paints Round. So each is held against an answer that is exact, in two
// halves:
//
//   Node, on the pure `/*==TIPS==*/` and `/*==PEN==*/` sections:
//   * the four built-ins as coverage: Round is the gradient the brush always drew, Square covers the
//     corners Round does not and Hardness feathers it, the Rivet is a solid rim, a lighter dome and a
//     highlight, the Chip is a flake whose outline wanders — and its table is the formula;
//   * an image read as a tip in all three conventions (a shape on transparent, dark on light, light
//     on dark), a JPEG's off-white paper as no paint, a flat or empty image refused, cropped to what
//     it covers and brought down to 256;
//   * the resampler: an exact copy at the same size, a box average down, bilinear up, weights that
//     sum to 1;
//   * the records: a hand-edited or corrupt one refused, the library through IndexedDB (a stand-in
//     here, the real one in the page) and through a settings file's base64, both to the byte;
//   * one dab's dynamics (`Pen.dab`): all off is `Pen.size` / `Pen.flow` and draws nothing from the
//     stream; each jitter stays in its range and reaches its end; scatter is uniform over its disc
//     and never moves the walk; angle is the tip's Angle, the heading when it follows, and its
//     jitter; a stroke's stream is reproducible from its seed and each stroke channel has its own;
//   * the mirrored copy's heading, on the lifted `/*==MIRROR==*/` with the real `texel`: over a plate
//     with the bake the sheet's size, half and a quarter of it, and a plate whose mapping bends; and
//     near an island's rim, on a sheet padded the way the bake pads one (`/*==BAKE==*/`'s
//     `BakeMesh.packPositions`) — an island touching the rim, the padded gutter, a twin cut in two,
//     a padded copy tying its rim texel, a point rounding into the gutter, a map that folds back.
//
//   Headless Chrome, on the real page and the real stroke path:
//   * the Round tip with no dynamics is the stroke it was, to the byte — replayed by the loop this
//     item replaced;
//   * a turned Square reaches past half its size, and the undo tiles and the stroke buffer's dirty
//     rectangle take that in: its corner lands across a tile edge, a later stroke does not lay it
//     again, and undo takes it off;
//   * Angle follows the stroke — a bar tip laid down a vertical stroke turns to run along it — and the
//     shape tool's Stamp along turns each stamp to the path; the mirrored copy's heading is reflected;
//   * scatter, size, flow and angle jitter each show on the sheet, a stroke is reproducible from its
//     seed, and a scattered stroke comes off with one undo;
//   * the masked branch clips a turned dab exactly as it clips a round one; the Clone copies in the
//     tip's shape and fixes its offset at the brush, not at a scattered dab;
//   * a loaded image becomes a tip, is kept in IndexedDB and back after a reload, travels in a
//     settings file (and not in the localStorage copy), comes back from one after it was removed, and
//     removing it puts every tool that used it back on Round;
//   * the tip and its dynamics are the tool's; the panel shows Hardness and the angle rows only where
//     they mean something and hides both for Panel line; the recorder logs the tip without a file
//     name; the stamp is redrawn for a new tip and for new bytes under an old id, and a new colour
//     recolours the coverage rather than re-making it.
//
// The stroke's LATENCY with a tip and every dynamic on is `t47`'s, beside the rest of §3.3.
//
// Usage: node tools/t131_tips.mjs [--keep] [--chrome <path>]
import fs from "fs";
import { findBrowser, evalInPage, pageExpr, makeReport, ROOT } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const src = fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8");
const sectionOf = n => {
  const a = src.indexOf("\n/*==" + n + "==*/"), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("no " + n + " section in the page");
  return src.slice(a + 1, b);
};
// The library's IndexedDB half calls the page's idbGet / idbSet / idbDel. Here they are a Map, which
// is enough to hold what goes in and what comes back; the page half uses the real ones.
const store = new Map();
globalThis.idbGet = async k => store.has(k) ? structuredClone(store.get(k)) : null;
globalThis.idbSet = async (k, v) => { store.set(k, structuredClone(v)); };
globalThis.idbDel = async k => { store.delete(k); };
const { Tips } = new Function(sectionOf("TIPS").replace(/^"use strict";$/m, "") + "\nreturn { Tips };")();
const { Pen } = new Function(sectionOf("PEN").replace(/^"use strict";$/m, "") + "\nreturn { Pen };")();
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-9);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

console.log("=== the four built-in tips, as coverage ===");
{
  const n = 64, at = (c, x, y) => c[y * n + x];
  const round = Tips.make("round", n, 1), roundS = Tips.make("round", n, .7);
  const sq = Tips.make("square", n, 1), sqS = Tips.make("square", n, 0);
  const rivet = Tips.make("rivet", n), chip = Tips.make("chip", n);
  R.is([round, sq, rivet, chip].every(c => c instanceof Uint8Array && c.length === n * n) && Tips.make("chip", 1).length === 1,
    "each is n × n bytes, made at the size asked for — one texel too");
  // The gradient brushStamp draws: full to hardness × .95 of the radius, straight down to 0 at it.
  const ramp = (x, y, h) => { const r = Math.hypot((x + .5 - 32) / 32, (y + .5 - 32) / 32); return Math.round(255 * (r <= h ? 1 : r >= 1 ? 0 : (1 - r) / (1 - h))); };
  let off = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (at(roundS, x, y) !== ramp(x, y, .7 * .95)) off++;
  R.is(off === 0 && at(round, 32, 32) === 255 && at(round, 0, 0) === 0,
    "Round is the brush's own gradient, texel for texel — full to Hardness × .95 of the radius, nothing past it");
  R.is(at(sq, 2, 2) === 255 && at(round, 2, 2) === 0 && at(sq, 0, 0) > 0,
    `Square covers the corners Round leaves bare (${at(sq, 2, 2)} against ${at(round, 2, 2)} two texels in from a corner)`);
  R.is(at(sqS, 8, 32) < at(sq, 8, 32) - 100 && at(sqS, 32, 32) >= 250,
    `and Hardness feathers it the way it feathers Round: at 0 a texel a quarter in lays ${at(sqS, 8, 32)}, at 100 ${at(sq, 8, 32)}`);
  // Where each part is, in the tip's own −1…1: the dome inside .74 of the radius, the highlight a disc
  // of .3 about (−.3, −.3), the rim between .78 and .95.
  let dLo = 255, dHi = 0, hl = 255, rim = 255;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + .5 - 32) / 32, v = (y + .5 - 32) / 32, rr = Math.hypot(u, v), hd = Math.hypot(u + .3, v + .3) / .3, val = at(rivet, x, y);
    if (rr <= .74 && hd >= 1) { dLo = Math.min(dLo, val); dHi = Math.max(dHi, val); }
    if (hd < 1) hl = Math.min(hl, val);
    if (rr > .78 && rr < .95) rim = Math.min(rim, val);
  }
  R.is(rim === 255 && dLo >= 185 && dHi <= 240 && hl >= 20 && hl <= 60 && at(rivet, 0, 0) === 0,
    `the Rivet is a solid rim (${rim} all round), a dome that lays a little less (${dLo}–${dHi}) and a highlight towards the upper left that lays least of all (${hl}) — painted darker than the panel, the panel shows through its highlight`);
  R.is(at(rivet, 22, 22) < at(rivet, 42, 42) - 150,
    `lit from the upper left: the highlight is there (${at(rivet, 22, 22)}) and not opposite it (${at(rivet, 42, 42)})`);
  const ext = [];
  const C = Tips.make("chip", 256, 1);
  for (let k = 0; k < 16; k++) {
    const a = k * Math.PI / 8;
    let r = 0;
    for (; r < 128; r++) { const x = Math.round(128 + r * Math.cos(a) - .5), y = Math.round(128 + r * Math.sin(a) - .5); if (C[y * 256 + x] < 128) break; }
    ext.push(r);
  }
  R.is(C[128 * 256 + 128] === 255 && C[0] === 0 && Math.max(...ext) - Math.min(...ext) > 30 && Math.max(...ext) < 128,
    `the Chip is a flake, not a disc: from its centre it reaches ${Math.min(...ext)}–${Math.max(...ext)} of 128 texels depending on the direction, and never the corners`);
  let worst = 0, smooth = 0;
  for (let i = 0; i <= 200000; i++) {
    const t = -Math.PI + 2 * Math.PI * i / 200000, f = Tips.chipR(t), e = Math.abs(Tips.chipAt(t) - f);
    worst = Math.max(worst, e);
    if (f > .31 && f < .97) smooth = Math.max(smooth, e);
  }
  R.is(worst < 2e-4 && smooth < 1e-5,
    `and its outline from the table is the formula's to ${worst.toExponential(1)} of the radius over 200 001 angles (${smooth.toExponential(1)} away from the clamp) — under a thirtieth of a texel at the largest size`);
  R.is(Tips.sum(chip, n, n) === Tips.sum(Tips.make("chip", n), n, n) && Tips.sum(rivet, n, n) === Tips.sum(Tips.make("rivet", n, .2), n, n),
    "made twice they are the same bytes, and Hardness does not touch a Rivet or a Chip");
  R.is(Tips.hard("round") && Tips.hard("square") && !Tips.hard("rivet") && !Tips.hard("chip") && !Tips.turns("round") && Tips.turns("square") && Tips.turns("chip"),
    "Hardness shapes Round and Square only, and every tip but Round looks different turned");
  // The Chip and the Rivet are made by loops that skip what cannot vary (4.50 (10)'s review: asked
  // texel by texel through `cover` they held the first dab after a change 20-26 ms at Size 400).
  // Faster must not mean different: each is `cover`'s own bytes, at every size a dab can be.
  const byCover = (kind, n) => {
    const o = new Uint8Array(n * n), c = n / 2, k = 2 / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) o[y * n + x] = Math.round(255 * Tips.cover(kind, (x + .5 - c) * k, (y + .5 - c) * k, .95, n));
    return o;
  };
  let sizes = 0, differ = [];
  for (let n2 = 1; n2 <= 420; n2 += n2 < 64 ? 1 : 7) for (const kind of ["chip", "rivet"]) { sizes++; if (!same(Tips.make(kind, n2), byCover(kind, n2))) differ.push(kind + " " + n2); }
  R.is(differ.length === 0, `the Chip and the Rivet from their quick loops are cover's own bytes at ${sizes / 2} sizes from 1 to 414 (${differ.length ? "differ: " + differ.slice(0, 6).join(", ") : "none differs"})`);
  const tm = kind => { let best = Infinity; for (let i = 0; i < 3; i++) { const a = performance.now(); Tips.make(kind, 400); best = Math.min(best, performance.now() - a); } return best.toFixed(1); };
  console.log(`   made at 400 in Node, best of 3: Chip ${tm("chip")} ms, Rivet ${tm("rivet")} ms, Square ${tm("square")} ms (t47 gates the first dab in the page)`);
}

console.log("\n=== an image read as a tip ===");
{
  const img = (w, h, f) => { const px = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(f(x, y), (y * w + x) * 4); return px; };
  const disc = (x, y) => Math.hypot(x - 15.5, y - 15.5) < 8;
  const ink = img(32, 32, (x, y) => disc(x, y) ? [0, 0, 0, 255] : [0, 0, 0, 0]);
  const a = Tips.fromImage(ink, 32, 32);
  R.is(a && a.w === 16 && a.h === 16 && a.cov[8 * 16 + 8] === 255 && a.cov[0] === 0,
    `a black shape on a transparent background: the shape lays everything, the rest nothing, cropped to it (${a && a.w + " × " + a.h})`);
  const white = Tips.fromImage(img(32, 32, (x, y) => disc(x, y) ? [255, 255, 255, 255] : [0, 0, 0, 0]), 32, 32);
  R.is(white && white.cov[8 * 16 + 8] === 255 && same(white.cov, a.cov), "white on transparent reads the same — where Photoshop's reading would find nothing");
  const grey = Tips.fromImage(img(32, 32, (x, y) => disc(x, y) ? (Math.hypot(x - 15.5, y - 15.5) < 3 ? [128, 128, 128, 255] : [0, 0, 0, 255]) : [0, 0, 0, 0]), 32, 32);
  R.is(grey && grey.cov[8 * 16 + 8] === 127 && grey.cov[8 * 16 + 2] === 255, `and on a dark shape a grey highlight lays less (${grey && grey.cov[8 * 16 + 8]})`);
  const paper = Tips.fromImage(img(40, 30, (x, y) => x >= 10 && x < 30 && y >= 5 && y < 25 ? [0, 0, 0, 255] : [255, 255, 255, 255]), 40, 30);
  R.is(paper && paper.w === 20 && paper.h === 20 && paper.cov.every(v => v === 255),
    `dark ink on light paper, opaque, as Photoshop and GIMP draw tips: the ink is the tip, the paper none of it (${paper && paper.w + " × " + paper.h})`);
  const neg = Tips.fromImage(img(40, 30, (x, y) => x >= 10 && x < 30 && y >= 5 && y < 25 ? [255, 255, 255, 255] : [0, 0, 0, 255]), 40, 30);
  R.is(neg && neg.w === 20 && neg.cov.every(v => v === 255), "light on dark, as Substance's alphas are: the same tip");
  const jpeg = Tips.fromImage(img(40, 30, (x, y) => x >= 10 && x < 30 && y >= 5 && y < 25 ? [12, 12, 12, 255] : (x + y) % 3 ? [245, 245, 245, 255] : [238, 238, 238, 255]), 40, 30);
  R.is(jpeg && jpeg.w === 20 && jpeg.h === 20 && jpeg.cov.every(v => v === 255),
    "a JPEG's off-white paper, speckled, lays nothing — a square round every dab otherwise — and its dark grey ink lays everything");
  R.is(Tips.fromImage(img(8, 8, () => [200, 200, 200, 255]), 8, 8) === null && Tips.fromImage(img(8, 8, () => [0, 0, 0, 0]), 8, 8) === null &&
       Tips.fromImage(new Uint8ClampedArray(8), 8, 8) === null,
    "a flat image, a wholly transparent one and a short buffer have nothing to use, and say so (null)");
  const big = Tips.fromImage(img(600, 300, () => [0, 0, 0, 255]).map((v, i) => i % 4 === 3 ? 200 : v), 600, 300);
  R.is(big && big.w === 256 && big.h === 128 && big.cov.every(v => v === 200),
    `a big one is brought down to 256 on its longer side, its proportions and its level kept (${big && big.w + " × " + big.h})`);
  // A few texels that are not opaque do not make an opaque picture a shape on a transparent
  // background (4.50 (10)'s review: ONE transparent corner read a black dot on white inverted — the
  // paper laid everything, the ink nothing, uncropped). Each of these is a black disc of radius 20
  // on white paper, 64 × 64, and must read as the 40 × 40 disc it is, ink 255 and paper 0.
  const dot = (x, y) => Math.hypot(x + .5 - 32, y + .5 - 32) < 20;
  const onPaper = odd => img(64, 64, (x, y) => odd(x, y) || (dot(x, y) ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const corner = (x, y) => (x < 1 || x > 62) && (y < 1 || y > 62);
  const cases = {
    "opaque": onPaper(() => null),
    "one corner at alpha 0": onPaper((x, y) => x === 0 && y === 0 ? [255, 255, 255, 0] : null),
    "one corner at 249": onPaper((x, y) => x === 0 && y === 0 ? [255, 255, 255, 249] : null),
    "four corners at 128": onPaper((x, y) => corner(x, y) ? [255, 255, 255, 128] : null),
    "rounded corners": onPaper((x, y) => { const dx = Math.max(0, 6 - x, x - 57), dy = Math.max(0, 6 - y, y - 57); return Math.hypot(dx, dy) > 6 ? [0, 0, 0, 0] : null; }),
    "an antialiased edge": onPaper((x, y) => x === 63 ? [255, 255, 255, 200] : null),
    "a transparent frame": onPaper((x, y) => x === 0 || y === 0 || x === 63 || y === 63 ? [0, 0, 0, 0] : null),
  };
  const read = Object.entries(cases).map(([k, px]) => {
    const t = Tips.fromImage(px, 64, 64);
    let ink = 0, paper = 0, nI = 0, nP = 0;
    if (t) for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
      const v = t.cov[y * t.w + x];
      if (dot(x + 12, y + 12)) { ink += v; nI++; } else { paper += v; nP++; }
    }
    return { k, ok: !!t && t.w === 40 && t.h === 40 && ink / nI > 250 && paper / nP < 12, at: t ? `${t.w}×${t.h} ink ${Math.round(ink / nI)} paper ${Math.round(paper / nP)}` : "null" };
  });
  const wrong = read.filter(c => !c.ok);
  R.is(wrong.length === 0, `dark ink on paper with a transparent corner, rounded corners, an antialiased edge or a transparent frame is still ink on paper — cropped to the ink, the paper none of it (${wrong.length ? wrong.map(c => c.k + ": " + c.at).join("; ") : read.map(c => c.at).slice(0, 2).join(", ") + " …"})`);
  // …while transparency that IS the shape stays the shape: a disc touching all four edges (a fifth of
  // it see-through), and a tightly cropped opaque rounded square with nothing on paper to read.
  const inscribed = Tips.fromImage(img(40, 40, (x, y) => Math.hypot(x + .5 - 20, y + .5 - 20) < 20 ? [0, 0, 0, 255] : [255, 255, 255, 0]), 40, 40);
  const rsq = Tips.fromImage(img(40, 40, (x, y) => { const dx = Math.max(0, 3 - x, x - 36), dy = Math.max(0, 3 - y, y - 36); return Math.hypot(dx, dy) > 3 ? [0, 0, 0, 0] : [0, 0, 0, 255]; }), 40, 40);
  R.is(inscribed && inscribed.w === 40 && inscribed.cov[20 * 40 + 20] >= 250 && inscribed.cov[0] === 0 && rsq && rsq.w === 40 && rsq.cov[20 * 40 + 20] >= 250 && rsq.cov[0] === 0,
    `a shape on transparent still reads as the shape: a disc touching every edge (centre ${inscribed && inscribed.cov[20 * 40 + 20]}, corner ${inscribed && inscribed.cov[0]}) and a rounded square with 2 % of it clear (centre ${rsq && rsq.cov[20 * 40 + 20]}, corner ${rsq && rsq.cov[0]})`);
}

console.log("\n=== the resampler ===");
{
  const src8 = Uint8Array.from({ length: 64 }, (_, i) => (i * 37) & 255);
  R.is(same(Tips.scale(src8, 8, 8, 8, 8), src8), "at the same size it is an exact copy");
  const board = Uint8Array.from({ length: 16 }, (_, i) => ((i & 3) + (i >> 2)) % 2 ? 255 : 0);
  R.is(Tips.scale(board, 4, 4, 2, 2).every(v => v === 128), "shrinking averages what each output texel covers: a checkerboard halved is mid-grey, not aliased");
  R.is(same(Tips.scale(Uint8Array.from([0, 255]), 2, 1, 4, 1), [0, 64, 191, 255]), "enlarging is bilinear, texel centre to texel centre");
  let ok = true;
  for (const [n, N] of [[256, 20], [256, 400], [7, 3], [3, 7], [100, 100], [255, 256]])
    for (const r of Tips.weights(n, N)) { let s = 0; for (let i = 1; i < r.length; i += 2) s += r[i]; if (!near(s, 1, 1e-9)) ok = false; }
  R.is(ok, "every output texel's weights sum to 1, shrinking or enlarging");
}

console.log("\n=== records, the library, and a settings file ===");
{
  const cov = Uint8Array.from([0, 64, 128, 255, 255, 1]);
  const r = Tips.record({ id: "t1abc", name: "x".repeat(80), w: 3, h: 2, cov });
  R.is(r && r.w === 3 && r.h === 2 && same(r.cov, cov) && r.name.length === 60 && typeof r.sum === "string", "a tip record is kept as it is, its name cut to 60");
  R.is([{ id: "round", w: 3, h: 2, cov }, { id: "../t1", w: 3, h: 2, cov }, { id: "T1", w: 3, h: 2, cov }, { id: 5, w: 3, h: 2, cov },
        { id: "t1", w: 2, h: 2, cov }, { id: "t1", w: 300, h: 2, cov: new Uint8Array(600) }, { id: "t1", w: 3, h: 2, cov: "@@@" },
        { id: "t1", w: 3, h: 2, cov: [0, 1, 2, 3, 4, 5] }, null].every(x => Tips.record(x) === null),
    "one that could not be a tip is refused: a built-in's or a path's id, a size its bytes do not fill, over 256, bytes that are not base64 or not bytes");
  R.is(Tips.record({ id: "t1", w: 3, h: 2, cov: Tips.b64(cov) }) && same(Tips.record({ id: "t1", w: 3, h: 2, cov: Tips.b64(cov) }).cov, cov),
    "a settings file's base64 is read back to the same bytes");
  const c2 = cov.slice(); c2[5] = 2;
  R.is(Tips.sum(cov, 3, 2) !== Tips.sum(c2, 3, 2) && Tips.sum(cov, 3, 2) !== Tips.sum(cov, 2, 3), "its sum changes with one byte, and with the shape");

  const id = await Tips.add({ w: 3, h: 2, cov }, "dot");
  const kept = store.get("tip:" + id), idx = store.get("tipIndex");
  R.is(/^t[0-9a-z]+$/.test(id || "") && kept && same(kept.cov, cov) && idx.length === 1 && idx[0].id === id && !("cov" in idx[0]),
    "Tips.add keeps the bytes under tip:<id> and lists it in tipIndex without them — the decal library's arrangement");
  const sum = Tips.lib.get(id).sum;
  Tips.lib.clear(); Tips.ready = false;
  R.is(Tips.valid(id) && Tips.valid("t9zz") && !Tips.valid("x9") && !Tips.valid(5), "before the library is read, any id shaped like one of its own may be named");
  store.set("tipIndex", idx.concat([{ id: "tbroken" }])); store.set("tip:tbroken", { id: "tbroken", w: 4, h: 4, cov: new Uint8Array(3) });
  const n = await Tips.load();
  R.is(n === 1 && Tips.ready && Tips.lib.get(id).sum === sum && !Tips.lib.has("tbroken"),
    "Tips.load reads it back to the byte, and skips a stored record that is broken rather than handing the stamp bad bytes");
  R.is(!Tips.valid("t9zz") && Tips.valid(id) && Tips.valid("chip"), "once it has been read, only a tip it holds is valid");
  const T = Tips.get(id), U = Tips.get("tnone");
  R.is(T.key === id + ":" + sum && T.turns && !T.hard && T.cov && U.id === "round",
    "a library tip's stamp key carries its bytes' sum, and an id that names nothing is Round");
  R.is(Tips.of({ tool: "height", tip: id }).id === "round" && Tips.of({ tool: "paint", tip: id }).id === id,
    "Panel line's bump is analytic and has no tip: whatever its row holds, it is Round");
  const file = JSON.parse(JSON.stringify(Tips.serialise()));
  R.is(file.length === 1 && file[0].id === id && typeof file[0].cov === "string", "a settings file carries each tip as base64");
  Tips.lib.clear();
  const got = Tips.adopt(file);
  await got.done;
  R.is(got.added === 1 && Tips.lib.get(id).sum === sum && Tips.adopt(file).added === 0,
    "and adopting it puts the same bytes back — once: a tip already there with the same bytes is left alone");
  R.is(await Tips.remove(id) && !Tips.lib.has(id) && !store.has("tip:" + id) && !store.get("tipIndex").some(x => x.id === id) &&
       store.get("tipIndex").some(x => x.id === "tbroken") && !(await Tips.remove(id)),
    "Tips.remove takes it out of the library, the store and the index — leaving the row it could not read for a build that can — and a second remove is a no");
  R.is(await Tips.add(null, "x") === null && await Tips.add({ w: 2, h: 2, cov: new Uint8Array(3) }, "x") === null, "and nothing that is not a tip is added");
  // Two tabs (4.50 (10)'s review). Tab B read the library before tab A added a tip, so its memory
  // does not hold it; B adding and removing tips of its own must not write A's out of the index.
  store.clear(); Tips.lib.clear();
  const idA = await Tips.add({ w: 3, h: 2, cov }, "added in tab A");
  Tips.lib.delete(idA);                                        // tab B's memory, from before A added it
  const idB = await Tips.add({ w: 3, h: 2, cov: c2 }, "added in tab B"), idB2 = await Tips.add({ w: 3, h: 2, cov }, "and another");
  await Tips.remove(idB2);
  const rows = store.get("tipIndex").map(x => x.id);
  Tips.lib.clear(); Tips.ready = false;
  await Tips.load();
  R.is(rows.includes(idA) && rows.includes(idB) && !rows.includes(idB2) && Tips.lib.has(idA) && Tips.lib.has(idB) && store.has("tip:" + idA),
    `a second tab that adds and removes tips of its own keeps the first tab's in the index, and the next visit has both (${rows.length} rows: ${rows.includes(idA) ? "A kept" : "A DROPPED"}, ${rows.includes(idB) ? "B kept" : "B missing"})`);
  // …and one page's writes go one at a time: two adds in flight together do not each read the index
  // before the other has written it.
  store.clear(); Tips.lib.clear();
  const both = await Promise.all([Tips.add({ w: 3, h: 2, cov }, "one"), Tips.add({ w: 3, h: 2, cov: c2 }, "two"), Tips.adopt([{ id: "tfile1", name: "from a file", w: 3, h: 2, cov: Tips.b64(cov) }]).done]);
  const rows2 = store.get("tipIndex").map(x => x.id);
  R.is(rows2.length === 3 && rows2.includes(both[0]) && rows2.includes(both[1]) && rows2.includes("tfile1"),
    `two tips added and a settings file adopted at once are all in the index (${rows2.length} of 3)`);
  for (const x of rows2) await Tips.remove(x);
  store.clear(); Tips.lib.clear(); Tips.ready = true;
  R.is(near(Tips.reach({ width: 40, height: 40 }, 40, 0), 20) && near(Tips.reach({ width: 40, height: 40 }, 40, Math.PI / 4), Math.hypot(40, 40) / 2) &&
       near(Tips.reach({ width: 40, height: 10 }, 40, 1), Math.hypot(40, 10) / 2),
    "a dab reaches half its size, and turned, half its diagonal — the square's corners, or an image's");
}

console.log("\n=== one dab's dynamics (Pen.dab) ===");
{
  const brush = o => Object.assign({ size: 40, spacing: .35, opacity: 1, flow: .8, pSize: true, pFlow: true, curve: 1,
    sizeJit: 0, flowJit: 0, scatter: 0, angle: 0, angleJit: 0, follow: false }, o || {});
  const counted = rnd => { const f = () => { f.n++; return rnd(); }; f.n = 0; return f; };
  const q = { x: 100, y: 50, p: .6 }, b0 = brush();
  const r0 = counted(Pen.rng(1)), d0 = Pen.dab(b0, q, 1.2, r0);
  R.is(!Pen.dynamic(b0) && d0.x === 100 && d0.y === 50 && d0.size === Pen.size(b0, .6) && d0.flow === Pen.flow(b0, .6) && d0.angle === 0 && r0.n === 0,
    "all off, a dab is Pen.size and Pen.flow at its pressure, where the walk put it, unturned — and nothing is drawn from the stream");
  R.is(Pen.dab(brush({ angle: 90 }), q, 1.2, null).angle === Math.PI / 2 && Pen.dab(brush({ angle: 90, follow: true }), q, 1.2, null).angle === Math.PI / 2 + 1.2 &&
       Pen.dab(brush({ angle: 90, follow: true }), q, null, null).angle === Math.PI / 2,
    "its angle is the tip's Angle, plus the heading when it follows the stroke — and just the Angle before anything says which way that is");
  const draw = (o, N) => { const b = brush(o), rnd = counted(Pen.rng(7)), out = []; for (let i = 0; i < N; i++) out.push(Pen.dab(b, { x: 0, y: 0, p: 1 }, 0, rnd)); out.n = rnd.n; return out; };
  const S = draw({ sizeJit: .5 }, 20000), sz = S.map(d => d.size);
  R.is(sz.every(v => v <= 40 && v >= 20) && Math.min(...sz) < 20.1 && near(sz.reduce((a, v) => a + v, 0) / sz.length, 30, .3) && S.n === 20000,
    `size jitter 50 %: every dab between 20 and 40 texels, reaching both ends, 30 on average — one draw a dab (${Math.min(...sz).toFixed(2)}–${Math.max(...sz).toFixed(2)})`);
  R.is(draw({ sizeJit: 1, size: 2 }, 2000).every(d => d.size >= 1), "and never under one texel");
  const F = draw({ flowJit: .75 }, 20000).map(d => d.flow);
  R.is(F.every(v => v <= 1 && v >= .25 - 1e-12) && Math.min(...F) < .255 && Math.max(...F) > .99,
    `flow jitter 75 %: every dab lays between a quarter and all of what it would (${Math.min(...F).toFixed(3)}–${Math.max(...F).toFixed(3)}) — Flow itself goes on as the dab's alpha beside it, as before`);
  const A = draw({ angleJit: .25, angle: 30 }, 20000).map(d => d.angle - Math.PI / 6);
  R.is(A.every(v => Math.abs(v) <= Math.PI / 4 + 1e-12) && Math.max(...A) > Math.PI / 4 - .01 && Math.min(...A) < -Math.PI / 4 + .01,
    "angle jitter 25 %: up to a quarter of half a turn either side of the Angle, both ways");
  const Sc = draw({ scatter: 1.5 }, 40000), dist = Sc.map(d => Math.hypot(d.x, d.y));
  const inner = dist.filter(v => v <= 30).length / dist.length, mx = Sc.reduce((a, d) => a + d.x, 0) / Sc.length, my = Sc.reduce((a, d) => a + d.y, 0) / Sc.length;
  R.is(dist.every(v => v <= 60 + 1e-9) && Math.max(...dist) > 59 && near(inner, .25, .015) && Math.abs(mx) < .6 && Math.abs(my) < .6 && Sc.n === 80000,
    `scatter 150 %: every dab within 1.5 of its size (60 texels) of the stroke, spread evenly over that disc — ${(inner * 100).toFixed(1)} % inside half its radius, where even is 25 % — with no drift`);
  const all = draw({ sizeJit: .3, flowJit: .3, angleJit: .3, scatter: .3 }, 100);
  R.is(all.n === 500, `every dynamic on draws five numbers a dab, in one fixed order (${all.n / 100})`);
  const a1 = Pen.rng(42), a2 = Pen.rng(42), a3 = Pen.rng(43);
  const s1 = Array.from({ length: 50 }, a1), s2 = Array.from({ length: 50 }, a2), s3 = Array.from({ length: 50 }, a3);
  let mean = 0; const rr = Pen.rng(3); for (let i = 0; i < 100000; i++) { const v = rr(); if (v < 0 || v >= 1) mean = NaN; mean += v; }
  R.is(same(s1, s2) && !same(s1, s3) && near(mean / 100000, .5, .005), "the stream is reproducible from its seed, differs with it, and is uniform on [0, 1)");
  const st = { seed: 9 }, st2 = { seed: 9 };
  R.is(Pen.stream(st, 0) === Pen.stream(st, 0) && Pen.stream(st, 0)() !== Pen.stream(st, 1)() && Pen.stream(st2, 0)() === Pen.rng(((9 >>> 0) + Math.imul(1, 0x9E3779B9)) >>> 0)(),
    "each stroke channel — the stroke, its mirror, each turned copy — has a stream of its own, made once from the stroke's seed");
  R.is(near(Pen.heading({ x: 0, y: 0 }, 10, 10, null, null), Math.PI / 4) && Pen.heading(null, 5, 5, .3, 2) === .3 && Pen.heading(null, 5, 5, null, 2) === 2 &&
       Pen.heading({ x: 5, y: 5 }, 5, 5, null, 1) === 1 && Pen.heading(null, 5, 5, null, null) === null,
    "the heading is the way from the last dab to this point; a dab laid on its own takes the caller's, then the channel's last, then none");
  // Past a UV seam (4.50 (10)'s review): the way the stroke moved on the model, in the frame of the
  // face it landed on. This face's UVs are turned a quarter: +x on the model is +v (up the UV, so UP
  // the sheet, whose y runs down), +y is −u.
  const FP = [[0, 0, 0], [1, 0, 0], [0, 1, 0]], FT = [[.5, .5], [.5, .6], [.4, .5]];
  const fh = d => Pen.faceHeading(d, FP[0], FP[1], FP[2], FT[0], FT[1], FT[2], 512, 512);
  R.is(near(fh([1, 0, 0]), -Math.PI / 2) && near(Math.abs(fh([0, 1, 0])), Math.PI) && near(fh([1, 0, 3]), -Math.PI / 2) && near(fh([0, -2, 0]), 0) &&
       near(Pen.faceHeading([1, 0, 0], FP[0], FP[1], FP[2], FT[0], FT[1], FT[2], 1024, 256), -Math.PI / 2) &&
       near(Pen.faceHeading([1, 1, 0], FP[0], FP[1], FP[2], FT[0], [.6, .5], [.5, .6], 1024, 256), Math.atan2(-.1 * 256, .1 * 1024)),
    "a 3-D stroke's step, carried into the face's own UV frame: a quarter-turned island turns it a quarter, a step off the face's plane counts only along it, and a non-square sheet stretches it");
  R.is(Pen.faceHeading([1, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0], FT[0], FT[1], FT[2], 512, 512) === null && Pen.faceHeading([0, 0, 1], FP[0], FP[1], FP[2], FT[0], FT[1], FT[2], 512, 512) === null,
    "and says nothing for a face with no area, or a step straight into the face");
}

console.log("\n=== the mirrored copy's heading, over whole-texel answers ===");
{
  // The page's MIRROR section, with the real `texel` — rounding to the position bake's grid and
  // answering in its whole texels — over a synthetic bake: a flat plate 2 m across, mirrored about
  // x = 0, laid over the whole bake so that bake column i reflects to column w − 1 − i. What t131
  // first handed `heading` was a continuous reflection, which the real `texel` never returns, so it
  // could not see that a 4-texel step over whole-texel answers turned the copy by up to 18.7° on a
  // sheet up to 2048 and 36° on a 4096 one (4.50 (10)'s review).
  const got = [];
  const env = { symPlane: () => ({ a: "x", c: 0 }), symEnabled: () => true, App: { activeSlot: null },
    Bake: { cached: s => s && s._bake, key: () => "k", PAD: +(/\n  PAD: (\d+),/.exec(src) || [])[1] },
    GradFill: { bakeable: () => false }, Prog: { active: false },
    Cancelled: class extends Error {}, reportFailure: () => {}, setStatus: () => {},
    stampAt: (x, y, ch, opt) => got.push({ x, y, ch, opt }), stroke: { dirs: [], lasts: [null, null] } };
  if (!(env.Bake.PAD > 0)) throw new Error("no Bake.PAD in the page");
  const Mirror = new Function(...Object.keys(env), sectionOf("MIRROR").replace(/^"use strict";$/m, "") + "\nreturn Mirror;")(...Object.values(env));
  const deg = r => r * 180 / Math.PI, off = (h, want) => Math.abs(deg(Math.atan2(Math.sin(h - want), Math.cos(h - want))));
  // `warp` bends the plate's columns by warp · w · (t − ½)² at row fraction t, so bake column i
  // reflects to w − 1 − i less that — a mapping whose heading turns across the sheet, which a chord read
  // from q to one side only gets wrong by its curve and one read across q does not.
  const plate = (w, warp) => {
    const pos = new Uint16Array(w * w * 3), has = new Uint8Array(w * w).fill(1), sp = 2 + (warp || 0) / 2;
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, t = (y + .5) / w, X = (x + .5) / w * 2 - 1 + (warp || 0) * (t - .5) * (t - .5);
      pos[i * 3] = Math.round((X + sp / 2) / sp * 65535); pos[i * 3 + 1] = Math.round(t * 65535);
    }
    return { kind: "pos", w, h: w, pos, has, cov: has, bb: { x0: -sp / 2, x1: sp / 2, y0: 0, y1: 2, z0: 0, z1: 0 }, key: "k" };
  };
  const bake = plate(512);
  // The same 40 points of the bake on every sheet, so a sheet 2 or 4 times its bake — a 4096 or an
  // 8192 sheet over the 2048 bake — is asked exactly what a sheet the bake's size is.
  const sweep = (W, bk, warp) => {
    const s = { composite: { width: W, height: W }, _bake: bk }, k = 512 / W;
    let worst = 0, sum = 0, n = 0, none = 0;
    for (let d = 0; d < 180; d += 3) for (let j = 0; j < 40; j++) {
      const a = d * Math.PI / 180, p = { x: (150 + 5.31 * j) / k, y: (150 + 5.17 * j) / k };
      const q = Mirror.texel(s, p.x, p.y), h = q && Mirror.heading(s, p, q, a);
      if (h == null) { none++; continue; }
      const t = (p.y * k + .5) / 512;                   // a vertical mirror turns (cos a, sin a) into (−cos a, sin a)…
      const e = off(h, Math.atan2(Math.sin(a), -Math.cos(a) - 2 * (warp || 0) * (t - .5) * Math.sin(a)));   // …bent by the warp
      worst = Math.max(worst, e); sum += e; n++;
    }
    return { worst: +worst.toFixed(2), mean: +(sum / Math.max(1, n)).toFixed(3), none };
  };
  const eq = sweep(512, bake), half = sweep(1024, bake), quarter = sweep(2048, bake);
  R.is([eq, half, quarter].every(r => r.none === 0 && r.worst < 2 && r.mean < .4),
    `over 2 400 headings, the mirrored copy is turned the reflected way to within ${eq.worst}° (mean ${eq.mean}°) with the bake the sheet's size, ${half.worst}° (${half.mean}°) with it half and ${quarter.worst}° (${quarter.mean}°) with it a quarter — the chord is read in bake texels; a 4-texel step read 18.7°, 36° and 78°, and the same 32 in sheet texels 1.8° (0.59°) and 4.0° (1.19°)`);
  const bent = sweep(512, plate(512, 1), 1);
  R.is(bent.none === 0 && bent.worst < 3 && bent.mean < .6,
    `where the mapping bends, the chord is read ACROSS q and the bend cancels: within ${bent.worst}° (mean ${bent.mean}°) — read from q to one side it was 6.8° (1.64°)`);

  // **Near an island's rim** (the review's second round, 2026-09-27). Everything above is one island
  // over the whole bake: no rim, no gutter, nothing else on the sheet, so a chord that ran off its
  // island could not be seen — and on real sheets, within 8 texels of a rim, 10–16 % of copies were
  // turned more than 45° off. This sheet is laid the way `Bake.position` lays one — three planes padded
  // PAD deep by the page's own `BakeMesh.packPositions` — with a plate A; a fin C whose UVs TOUCH A's
  // right rim; A's twin a quarter turned, in two pieces, the second 12 across from where the
  // first would carry on; and the fin's twin, touching A's twin, laid the other way round. Every copy
  // is on A's twin, so the true heading is the stroke's turned a quarter.
  const { BakeMesh } = new Function(sectionOf("ENCODE") + "\n" + sectionOf("BAKE").replace(/^"use strict";$/m, "") + "\nreturn { BakeMesh };")();
  const BB = { x0: -1, x1: 1, y0: 0, y1: 1, z0: 0, z1: .25 }, S = .9 / 176;     // S: metres a texel
  const sheetOf = (w, parts) => {
    const n = w * w, p0 = new Uint8Array(n * 4), p1 = new Uint8Array(n * 4), p2 = new Uint8Array(n * 4);
    const q16 = (v, lo, hi) => Math.round((v - lo) / (hi - lo) * 65535);
    for (const [u0, v0, u1, v1, at] of parts) for (let v = v0; v < v1; v++) for (let u = u0; u < u1; u++) {
      const P = at(u, v), i = (v * w + u) * 4, Q = [q16(P[0], BB.x0, BB.x1), q16(P[1], BB.y0, BB.y1), q16(P[2], BB.z0, BB.z1)];
      for (let k = 0; k < 3; k++) { p0[i + k] = Q[k] >> 8; p1[i + k] = Q[k] & 255; p2[i + k] = 128; }
      p0[i + 3] = p1[i + 3] = p2[i + 3] = 255;
    }
    const r = BakeMesh.packPositions(p0, p1, p2, w, w, env.Bake.PAD);
    return { kind: "pos", w, h: w, pos: r.pos, has: r.has, cov: r.cov, bb: BB, key: "k" };
  };
  const rimBake = sheetOf(512, [
    [40, 40, 216, 216, (u, v) => [-1 + (u + .5 - 40) * S, (v + .5 - 40) * S, 0]],                // A, the plate
    [216, 40, 240, 120, (u, v) => [-.3, (v + .5 - 40) * S, .05 + (u + .5 - 216) * S]],           // C, the fin, touching A
    [300, 291, 428, 467, (u, v) => [1 - (466.5 - v) * S, (u - 299.5) * S, 0]],                  // A's twin, a quarter turned…
    [440, 291, 488, 467, (u, v) => [1 - (466.5 - v) * S, (u - 311.5) * S, 0]],                  // …and its second piece
    [300, 267, 380, 291, (u, v) => [.3, (379.5 - u) * S, .05 + (v + .5 - 267) * S]],            // C's twin, touching A's, reversed
  ]);
  const rs = { composite: { width: 512, height: 512 }, _bake: rimBake };
  const rimRun = pts => {
    let worst = 0, sum = 0, n = 0, none = 0;
    for (const [u, v] of pts) for (let d = 0; d < 360; d += 15) {
      const a = d * Math.PI / 180, p = { x: u, y: v }, q = Mirror.texel(rs, u, v), h = q && Mirror.heading(rs, p, q, a);
      if (h == null) { none++; continue; }
      const e = off(h, a - Math.PI / 2);
      worst = Math.max(worst, e); sum += e; n++;
    }
    return { worst: +worst.toFixed(1), mean: +(sum / Math.max(1, n)).toFixed(2), none, n };
  };
  const rimPts = [], seamPts = [];
  for (let v = 40; v < 216; v++) for (let u = 40; u < 216; u++) {
    const d = Math.min(u - 40, 215 - u, v - 40, 215 - v);
    if (d < 8 && (u + 2 * v) % 3 === 0) rimPts.push([u, v]);
    if (d >= 24 && v >= 152 && v < 184 && (u + v) % 4 === 0) seamPts.push([u, v]);
  }
  const fin = rimRun(rimPts.filter(([u, v]) => u > 207 && v < 120)), gut = rimRun(rimPts.filter(([u, v]) => !(u > 207 && v < 120)));
  R.is([fin, gut].every(r => r.worst <= 15 && r.mean < 1 && r.none <= .005 * (r.n + r.none)),
    `within 8 texels of the rim, the copy is turned the right way to within ${fin.worst}° (mean ${fin.mean}°) by the fin's touching island and ${gut.worst}° (${gut.mean}°) by the padded gutter — the worst is a 2-texel chord where the rim meets the twin's seam — with ${fin.none + gut.none} of ${fin.n + gut.n + fin.none + gut.none} headings unread, at corners; the branch before this read 111° (mean 9.5°) and 71° (1.4°), a walk blind to a jump in place 22°, one that stepped onto padding 75°, and the full chord whatever the island 75°`);
  const seam = rimRun(seamPts);
  R.is(seam.worst < 3 && seam.mean < .5 && seam.none === 0,
    `inside A, over the line where its twin is cut in two, a chord end that reflects onto the other piece is not read: within ${seam.worst}° (mean ${seam.mean}°) — kept, it read 10.7° (4.6°), and the branch before this 17.8° (4.5°)`);
  let padQ = 0, rimQ = 0;
  for (let k = 40; k < 216; k++) for (const [u, v] of [[40, k], [215, k], [k, 40], [k, 215]]) {
    const q = Mirror.texel(rs, u, v);
    if (!q) continue;
    rimQ++;
    if (!rimBake.cov[Math.round(q.y) * 512 + Math.round(q.x)]) padQ++;
  }
  R.is(rimQ > 600 && padQ === 0,
    `every rim texel of A mirrors onto a covered texel of its twin (${rimQ - padQ} of ${rimQ}), not a padded copy that ties with it — the scan used to keep the copy for 275 of 704`);
  const lead = [[215.6, 150, 0], [215.6, 150, 90], [39.4, 100, 90], [39.4, 100, 180], [100, 39.4, 0], [100, 215.6, 0]].map(([x, y, d]) => {
    const a = d * Math.PI / 180, q = Mirror.texel(rs, x, y), h = q && Mirror.heading(rs, { x, y }, q, a);
    return h == null ? null : +off(h, a - Math.PI / 2).toFixed(2);
  });
  R.is(lead.every(e => e != null && e < 1),
    `a point a fraction inside a rim, which rounds to the gutter beside it, reads the rim texel it stands for: ${JSON.stringify(lead)}° off along and across four rims (taken as it was, each read nothing)`);
  const s0 = { composite: { width: 512, height: 512 }, _bake: bake }, texel = Mirror.texel;
  const p0 = { x: 290, y: 250 }, q0 = texel(s0, 290, 250);
  Mirror.texel = (s, x, y) => x > 300 ? null : texel(s, x, y);                    // nothing past x = 300 reflects
  const edge = Mirror.heading(s0, p0, q0, 0);
  Mirror.texel = (s, x, y) => x > 300 ? { x: x - 250, y: y + 150, g: 1 } : texel(s, x, y);   // …or it leaps to another island
  const leap = Mirror.heading(s0, p0, q0, 0);
  Mirror.texel = () => null;
  const nowhere = Mirror.heading(s0, p0, q0, 0);
  // …or the map folds back: past x = 310 the far side runs the other way round (an island across the
  // plane whose two edges are one place), so the point 32 ahead reflects EAST of q, a plausible 38
  // texels off, while the point 16 ahead still reflects west. The halfway point says which.
  Mirror.texel = (s, x, y) => x > 310 ? { x: q0.x + (x - p0.x) * 1.2, y: q0.y, g: 1 } : texel(s, x, y);
  const fold = Mirror.heading(s0, p0, q0, 0);
  Mirror.texel = texel;
  R.is(near(Math.abs(edge), Math.PI, .06) && near(Math.abs(leap), Math.PI, .06) && nowhere === null,
    `a point ahead that reflects nowhere, or onto another island, is not read: the chord runs from the side that held (east reflects to ${(edge * 180 / Math.PI).toFixed(1)}° and ${(leap * 180 / Math.PI).toFixed(1)}°, want ±180°) — and nothing at all is null`);
  R.is(fold != null && near(Math.abs(fold), Math.PI, .06),
    `nor is one whose halfway point does not reflect halfway, where the map folds back: east reflects to ${fold == null ? "nothing" : deg(fold).toFixed(1) + "°"}, want ±180° (read, it turned the copy to 0°)`);
  // Through Mirror.stamp: Stamp along hands the copy the reflected heading; a freehand stroke hands its
  // copy the stroke's own heading, reflected, only where the copy leaps — anywhere else the copy's own
  // walk says which way it runs.
  env.App.activeSlot = s0;
  Mirror.begin(); got.length = 0;
  Mirror.stamp({ x: 200, y: 250, a: 1 }, { jump: true, ang: 1 });
  const along = got[0] && got[0].opt;
  env.stroke.dirs = [Math.PI / 2, null];                                            // the stroke runs south
  Mirror.begin(); got.length = 0;
  Mirror.stamp({ x: 200, y: 250 }, null); Mirror.stamp({ x: 201, y: 258 }, null);
  Mirror.texel = (s, x, y) => y > 262 ? { x: x - 100, y: y + 100, g: 1 } : texel(s, x, y);   // past y = 262 the copy leaps
  Mirror.stamp({ x: 202, y: 266 }, null);
  Mirror.texel = texel;
  R.is(along && along.jump && near(along.ang, Math.PI - 1, .03) && got.length === 3 && !got[1].opt && got[2].opt && got[2].opt.jump && near(got[2].opt.ang, Math.PI / 2, .03),
    `the copy is handed the reflected heading where no walk of its own says it: a stamp laid alone (${along && along.ang != null ? along.ang.toFixed(3) : "none"}, want ${(Math.PI - 1).toFixed(3)}) and the dab a leap lands on (${got[2] && got[2].opt && got[2].opt.ang != null ? got[2].opt.ang.toFixed(3) : "none"}, want ${(Math.PI / 2).toFixed(3)}) — and none in between`);
}

// ---------------------------------------------------------------- the page
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("\nSKIP (page half): no Chrome or Edge found. Pass --chrome <path> or set CHROME."); R.finish(); }

const BODY = `async function(){
  var out = {}, N = 512, seq = 0;
  function fnv(u8){ var h = 0x811c9dc5; for (var i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function hash(c){ return fnv(ctx2d(c).getImageData(0, 0, c.width, c.height).data); }
  function al(c, x, y){ return ctx2d(c).getImageData(x, y, 1, 1).data[3]; }
  function across(c, y, x0, x1){ var d = ctx2d(c).getImageData(x0, y, x1 - x0, 1).data, n = 0; for (var i = 3; i < d.length; i += 4) if (d[i] >= 128) n++; return n; }
  function down(c, x, y0, y1){ var d = ctx2d(c).getImageData(x, y0, 1, y1 - y0).data, n = 0; for (var i = 3; i < d.length; i += 4) if (d[i] >= 128) n++; return n; }
  var FIELDS = ["size", "opacity", "hardness", "spacing", "flow", "build", "pSize", "pFlow", "curve", "lazy", "heal", "value",
                "tip", "sizeJit", "flowJit", "scatter", "angle", "angleJit", "follow"];
  var was = { slot: App.activeSlot, layer: App.activeLayer, p3: App.paint3d, mode: App.brush.mode, color: App.brush.color,
              tools: JSON.stringify(App.brushTools || {}), path: PathUI.path, confirm: window.confirm, texel: Mirror.texel,
              sym: window.symEnabled, bake: Mirror.bake, shape: Tips.shape, cursor: v2.cursor, lazy: v2.lazy, sc: v2.sc };
  FIELDS.forEach(function(k){ was[k] = App.brush[k]; });
  function set(o){
    App.brush.mode = "color"; App.brush.color = "#ff0000";
    Object.assign(App.brush, { size: 40, opacity: 1, hardness: 1, spacing: .35, flow: 1, build: false, pSize: true, pFlow: false,
      curve: 1, lazy: 0, heal: false, tip: "round", sizeJit: 0, flowJit: 0, scatter: 0, angle: 0, angleJit: 0, follow: false }, o || {});
    brushStamp._key = null;
  }
  function fresh(){
    var s = { id: "t131_" + (++seq), cStem: null, nStem: null, size: 0, layers: [], baseC: null, smooth: null, metal: null,
              normal: null, composite: null, tex: null, texCh: null, thumb: null, missing: true };
    App.slots.set(s.id, s);
    initPlaceholderAlbedo(s, N, N);
    App.activeSlot = s; App.activeLayer = null;
    flushComposites();
    return s;
  }
  function layer(){ return App.activeLayer ? App.activeLayer.canvas : null; }
  function line(pts, seed){
    beginStroke(false, false);
    if (seed != null) { stroke.seed = seed; stroke.rng = null; }
    pts.forEach(function(p){ stampAt(p[0], p[1], 0, null); });
    endStroke();
  }
  function run(x0, x1, y, step){ var a = []; for (var x = x0; x <= x1; x += step) a.push([x, y]); return a; }
  App.paint3d = true;
  try {

  // ---- A. the Round tip with no dynamics is the stroke it was ----
  // Replayed by the loop stampAt ran before this item (9946b28): Pen.walk's dabs, each drawn with one
  // drawImage of the full-size stamp scaled to the dab's size, at Flow. Byte for byte, or the default
  // brush has changed under everybody's hand.
  var s = fresh(); set({ hardness: .7, spacing: .2, flow: .6 });
  var P = [[60, 60], [200, 90], [330, 60], [450, 200], [300, 400], [120, 300]];
  line(P);
  var real = ctx2d(layer()).getImageData(0, 0, N, N).data;
  var ref = mkCanvas(N, N), rg = ctx2d(ref), st = brushStamp(), last = null, b = App.brush;
  P.forEach(function(p){
    var qs = last ? Pen.walk(last, p[0], p[1], 1, b, false) : [{ x: p[0], y: p[1], p: 1 }];
    qs.forEach(function(q){ var sz = Pen.size(b, q.p), r = sz / 2; rg.globalAlpha = Pen.deposit(b).dab * Pen.flow(b, q.p); rg.drawImage(st, q.x - r, q.y - r, sz, sz); last = q; });
  });
  var refd = rg.getImageData(0, 0, N, N).data, diff = 0, painted = 0;
  for (var i = 0; i < refd.length; i++) { if (refd[i] !== real[i]) diff++; if (i % 4 === 3 && real[i]) painted++; }
  out.round = { diff: diff, painted: painted };

  // ---- B. a turned Square reaches past half its size ----
  // One dab of 100 at 45° centred 55 texels left of the 256 tile edge: unturned it stops 3 short of
  // the edge, turned its corner reaches 271.7. The corner has to be recorded (or it is never applied),
  // cleared from the stroke buffer afterwards (or the next stroke lays it again), and undone.
  s = fresh(); set({ tip: "square", size: 100, angle: 45, opacity: .5 });
  line([[60, 460]]);
  var h0 = hash(layer());
  line([[201, 100]]);
  var c1 = al(layer(), 262, 100), h1 = hash(layer());
  line([[420, 100]]);
  var c2 = al(layer(), 262, 100);
  doUndo(); doUndo();
  out.turn = { c1: c1, c2: c2, changed: h1 !== h0, back: hash(layer()) === h0, flat: 0 };
  set({ tip: "square", size: 100, angle: 0, opacity: .5 });
  line([[201, 300]]);
  out.turn.flat = al(layer(), 252, 300) + "," + al(layer(), 262, 300);

  // ---- C. Angle follows the stroke: a bar tip laid down a vertical stroke ----
  var barC = mkCanvas(80, 24), bgc = ctx2d(barC);
  bgc.fillStyle = "#fff"; bgc.fillRect(0, 0, 80, 24); bgc.fillStyle = "#000"; bgc.fillRect(8, 8, 64, 8);
  var bar = Tips.fromImage(bgc.getImageData(0, 0, 80, 24).data, 80, 24);
  var barId = await Tips.add(bar, "t131 bar");
  out.bar = { w: bar && bar.w, h: bar && bar.h, id: barId };
  var vert = []; for (var y = 40; y <= 470; y += 10) vert.push([150, y]);
  s = fresh(); set({ tip: barId, size: 64, spacing: .1 });
  line(vert);
  out.bar.off = across(layer(), 250, 100, 200);
  s = fresh(); set({ tip: barId, size: 64, spacing: .1, follow: true });
  line(vert);
  out.bar.on = across(layer(), 250, 100, 200);
  out.bar.onDown = down(layer(), 150, 100, 400);

  // ---- D. the shape tool's Stamp along turns each stamp to the path ----
  function along(o){
    fresh(); set(Object.assign({ tip: "square", size: 40, spacing: .35 }, o));
    var p = Path.make(); Path.add(p, 100, 100); Path.add(p, 400, 400); PathUI.path = p;
    PathUI.stamp();
    // (118, 82): inside an upright 40-square on the first stamp, 25.5 texels off the path — outside
    // every stamp turned to face along it, whose half-width across the path is 20.
    return { off: al(layer(), 118, 82), mid: al(layer(), 250, 250) };
  }
  out.along = { plain: along({}), follow: along({ follow: true }) };
  PathUI.path = was.path;

  // ---- E. the mirrored copy's heading is reflected ----
  // Mirror.heading walks the position bake for how far the stroke's surface runs, so the stand-in is
  // a real one: a plate over the whole sheet, every texel covered, mirrored about its middle column.
  var plate = { kind: "pos", w: N, h: N, pos: new Uint16Array(N * N * 3), has: new Uint8Array(N * N).fill(1),
                bb: { x0: -1, x1: 1, y0: 0, y1: 2, z0: 0, z1: 0 }, key: "t131" };
  plate.cov = plate.has;
  for (var py = 0; py < N; py++) for (var px = 0; px < N; px++) {
    plate.pos[(py * N + px) * 3] = Math.round((px + .5) / N * 65535); plate.pos[(py * N + px) * 3 + 1] = Math.round((py + .5) / N * 65535);
  }
  Mirror.bake = function(){ return plate; };
  Mirror.texel = function(sl, x, y){ return { x: 512 - x, y: y }; };        // a mirror about x = 256
  out.mirror = { east: Mirror.heading(s, { x: 100, y: 100 }, { x: 412, y: 100 }, 0),
                 south: Mirror.heading(s, { x: 100, y: 100 }, { x: 412, y: 100 }, Math.PI / 2) };
  Mirror.texel = function(){ return null; };
  out.mirror.none = Mirror.heading(s, { x: 100, y: 100 }, { x: 412, y: 100 }, 0);
  // ...and through Mirror.stamp, which is what the page calls: with the sheet mirror stubbed as that
  // reflection, Stamp along's copy and a freehand stroke's copy are each the stroke's reflection
  // texel for texel when the tip follows — which they are not when the copy is handed the stroke's
  // own heading (4.50 (10)'s review: that passed every check this file had).
  window.symEnabled = function(){ return true; };
  Mirror.texel = function(sl, x, y){ return x >= 0 && x < 512 && y >= 0 && y < 512 ? { x: 512 - x, y: y, g: 1 } : null; };
  function halves(c){
    var dd = ctx2d(c).getImageData(0, 0, N, N).data, bad = 0, lit = 0;
    for (var y = 0; y < N; y++) for (var x = 0; x < 256; x++) {
      var a = dd[(y * N + x) * 4 + 3], b2 = dd[(y * N + 511 - x) * 4 + 3];
      if (a >= 128) lit++;
      if (Math.abs(a - b2) > 96) bad++;
    }
    return { lit: lit, mismatch: bad };
  }
  function alongM(o){
    fresh(); set(Object.assign({ tip: "square", size: 30, spacing: 1.2 }, o));
    var p = Path.make(); Path.add(p, 60, 100); Path.add(p, 200, 420); PathUI.path = p;
    PathUI.stamp();
    return halves(layer());
  }
  function freeM(o){
    fresh(); set(Object.assign({ tip: "square", size: 30, spacing: 1.2 }, o));
    beginStroke(false, false); Mirror.begin();
    for (var k = 0; k <= 40; k++) { var p = { x: 60 + 3.5 * k, y: 100 + 8 * k }; stampAt(p.x, p.y, 0, null); Mirror.stamp(p, null); }
    endStroke(); Mirror.begin();
    return halves(layer());
  }
  out.mirror.along = alongM({ follow: true });
  out.mirror.free = freeM({ follow: true });
  // A freehand copy that LEAPS — past y = 250 the stroke's far side is another island, laid along a
  // diagonal — lays its first dab there the way the copy runs from there on, the stroke's heading
  // reflected, not the way it ran on the island it left (4.50 (10)'s review). A 64 × 8 bar shows it.
  Mirror.texel = function(sl, x, y){
    if (y < 250) return { x: 512 - x, y: y, g: 1 };
    return { x: 100 + (y - 250) * Math.SQRT1_2, y: 400 + (y - 250) * Math.SQRT1_2, g: 1 };
  };
  fresh(); set({ tip: barId, size: 64, spacing: .1, follow: true });
  beginStroke(false, false); Mirror.begin();
  for (var yl = 100; yl <= 300; yl += 8) { stampAt(60, yl, 0, null); Mirror.stamp({ x: 60, y: yl }, null); }
  endStroke(); Mirror.begin();
  // The first dab past the leap is centred about (101, 401): a diagonal bar reaches (81, 381) up and
  // to the left of it, where no later dab goes; one lying across or standing up does not.
  out.mirror.leap = { diag: al(layer(), 81, 381), across: al(layer(), 81, 401), up: al(layer(), 101, 381) };
  window.symEnabled = was.sym; Mirror.bake = was.bake;
  Mirror.texel = was.texel;

  // ---- E2. a 3-D stroke's first dab past a UV seam faces the way it moves on the new island ----
  // Two quads side by side on the model, on two islands of the sheet: A's UVs run with it, B's are
  // turned a quarter, so moving +x on the model is east on A's island and NORTH on B's. The stroke's
  // hits are real raycasts against the mesh, handed to stamp3d as the 3-D pointer does.
  var geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 1,1,0, 0,1,0,  1,0,0, 2,0,0, 2,1,0, 1,1,0], 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute([.1,.6, .4,.6, .4,.9, .1,.9,  .9,.1, .9,.4, .6,.4, .6,.1], 2));
  geo.setIndex([0,1,2, 0,2,3, 4,5,6, 4,6,7]);
  var mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  var rc = new THREE.Raycaster();
  function hitAt(x){ rc.set(new THREE.Vector3(x, .5, 5), new THREE.Vector3(0, 0, -1)); return rc.intersectObject(mesh)[0]; }
  fresh(); set({ tip: barId, size: 64, spacing: .1, follow: true });
  beginStroke(false, false);
  for (var xs = 1; xs <= 9; xs++) stamp3d(hitAt(xs / 10), 0, null);             // east along A's island
  var seamHit = hitAt(1.1);
  stamp3d(seamHit, 0, null);                                                     // across the seam: one dab on B's
  endStroke();
  var spx = Math.round(seamHit.uv.x * N), spy = Math.round((1 - seamHit.uv.y) * N);
  out.seam = { at: spx + "," + spy, down: down(layer(), spx, spy - 50, spy + 50), across: across(layer(), spy, spx - 50, spx + 50),
               eastOnA: across(layer(), 128, 40, 230) };

  // ---- F. scatter, reproducible from the seed, and one undo ----
  s = fresh(); set({ size: 16, spacing: .25, scatter: 2 });
  line([[20, 20]], 1);                                                      // the layer, out of the way
  var hBlank = hash(layer());
  line(run(40, 470, 256, 10), 1234);
  var L = layer(), d = ctx2d(L).getImageData(0, 180, N, 152).data, offLine = 0, reach = 0;
  for (var yy = 0; yy < 152; yy++) for (var xx = 0; xx < N; xx++) if (d[(yy * N + xx) * 4 + 3]) {
    var dy = Math.abs(180 + yy + .5 - 256);
    if (dy > 9) offLine++;
    if (dy > reach) reach = dy;
  }
  var hA = hash(L);
  doUndo();
  out.scatter = { offLine: offLine, reach: reach, back: hash(layer()) === hBlank };
  s = fresh(); set({ size: 16, spacing: .25, scatter: 2 }); line([[20, 20]], 1); line(run(40, 470, 256, 10), 1234);
  out.scatter.again = hash(layer()) === hA;
  s = fresh(); set({ size: 16, spacing: .25, scatter: 2 }); line([[20, 20]], 1); line(run(40, 470, 256, 10), 99);
  out.scatter.other = hash(layer()) !== hA;

  // ---- G. size, flow and angle jitter show on the sheet ----
  function dabs(o, seed){
    fresh(); set(Object.assign({ tip: "square", size: 30, spacing: 1 }, o));
    line(run(40, 460, 256, 30), seed);
    var hs = [], cs = [], bare = 0;
    for (var x = 40; x <= 460; x += 30) {
      hs.push(down(layer(), x, 200, 312));
      cs.push(al(layer(), x, 256));
    }
    return { h: hs, c: cs };
  }
  out.jit = { plain: dabs({}), size: dabs({ sizeJit: .8 }, 5), flow: dabs({ flowJit: .8 }, 6) };
  function corners(o, seed){
    fresh(); set(Object.assign({ tip: "square", size: 30, spacing: 2 }, o));
    line(run(40, 460, 256, 60), seed);
    var n = 0, k = 0;
    for (var x = 40; x <= 460; x += 60) { k++; if (al(layer(), x + 13, 256 + 13) < 128) n++; }
    return n + "/" + k;
  }
  out.jit.anglePlain = corners({});
  out.jit.angle = corners({ angleJit: 1 }, 7);

  // ---- H. the masked branch clips a turned dab as it clips a round one ----
  function limited(scope){
    fresh(); set({ tip: "square", size: 80, angle: 30, spacing: .3 });
    line([[480, 480]]);
    if (scope) App.activeLayer.scope = Scope.make(null, { x: 256, y: 0, w: 256, h: 512 });
    line(run(200, 320, 150, 20));
    var dd = ctx2d(layer()).getImageData(0, 90, N, 120).data;
    App.activeLayer.scope = null;
    return dd;
  }
  // Not byte for byte: the masked branch has always drawn each dab through a scratch laid at a
  // fractional offset, which resamples its edge a second time — so the texels it covers are what is
  // compared. A scratch sized by the dab's Size rather than its reach would cut a turned Square's
  // corners off, a fifth of this stroke's height.
  var mA = limited(true), mB = limited(false), leak = 0, covA = 0, covB = 0, rowsA = 0, rowsB = 0;
  for (var yy2 = 0; yy2 < 120; yy2++) {
    var ra = 0, rb = 0;
    for (var xx2 = 0; xx2 < N; xx2++) {
      var k2 = (yy2 * N + xx2) * 4 + 3;
      if (xx2 <= 254 && mA[k2]) leak++;
      if (xx2 >= 258 && mA[k2] >= 128) { covA++; ra = 1; }
      if (xx2 >= 258 && mB[k2] >= 128) { covB++; rb = 1; }
    }
    rowsA += ra; rowsB += rb;
  }
  out.mask = { leak: leak, covA: covA, covB: covB, rowsA: rowsA, rowsB: rowsB };

  // ---- I. the Clone copies in the tip's shape, and fixes its offset at the brush ----
  s = fresh(); set({ size: 60, tip: "chip" }); App.brush.mode = "clone"; brushStamp._key = null;
  Clone.pick(s, 100, 100);
  line([[300, 300]]);
  out.clone = { centre: al(layer(), 300, 300), corner: al(layer(), 327, 327) };
  s = fresh(); set({ size: 40, tip: "square", scatter: 2, angle: 20 }); App.brush.mode = "clone"; App.brush.heal = true; brushStamp._key = null;
  Clone.pick(s, 100, 100);
  try { line([[300, 300], [360, 300], [420, 320]], 77); out.clone.off = s._cloneSrc.off[0] && [s._cloneSrc.off[0].x, s._cloneSrc.off[0].y].join(); }
  catch (e) { out.clone.threw = String(e && e.message || e); }
  App.brush.heal = false;
  // ...and on a camouflage tile (4.50 (6)), where each dab is stamped once per copy of the sheet it
  // touches: a dab thrown across the right edge is stamped at its copy inside the sheet FIRST, and the
  // offset is still fixed where the brush is, inside the sheet — not a tile's width off, which reads
  // the same texels but puts the dashed ring on the neighbouring copy.
  s = fresh(); s.camoTile = true; set({ size: 40, tip: "square", scatter: 2 }); App.brush.mode = "clone"; brushStamp._key = null;
  try {
    var dab0 = Pen.dab, thrown = null;
    for (var sd = 1; sd < 200 && !(thrown > 516); sd++) {         // the first seed that throws the dab past the edge
      Clone.pick(s, 100, 100); thrown = null;
      beginStroke(false, false); stroke.seed = sd; stroke.rng = null;
      Pen.dab = function(){ var d = dab0.apply(Pen, arguments); if (thrown == null) thrown = d.x; return d; };
      try { stampAt(500, 300, 0, null); } finally { Pen.dab = dab0; }
      endStroke();
    }
    out.clone.tile = { off: s._cloneSrc.off[0] && [s._cloneSrc.off[0].x, s._cloneSrc.off[0].y].join(), dab: thrown };
  } catch (e) { Pen.dab = dab0; out.clone.tile = { threw: String(e && e.message || e) }; }
  // A TURNED tip too (4.50 (10)'s review: only an unturned Chip was checked, and a Clone handed the
  // upright stamp passed). A 60-texel Square at 45° is a diamond reaching 42.4 along each axis:
  // (338, 300) is inside it and outside the upright square, (325, 325) the other way round.
  s = fresh(); set({ size: 60, tip: "square", angle: 45 }); App.brush.mode = "clone"; brushStamp._key = null;
  Clone.pick(s, 100, 100);
  line([[300, 300]]);
  out.clone.turned = { inside: al(layer(), 338, 300), corner: al(layer(), 325, 325) };
  // The turned dab is drawn into ONE scratch, dab after dab, and the tone weights follow each redraw
  // rather than the canvas's identity.
  var st2 = brushStamp(), sc1 = Tips.shape(st2, 60, 60, .3), w1 = Array.from(Clone.weights(sc1, 60));
  var sc2 = Tips.shape(st2, 60, 60, 1.2), w2 = Clone.weights(sc2, 60), fresh2 = mkCanvas(sc2.width, sc2.height);   // a canvas the size of the scratch: Skia antialiases a turned edge a level or two differently near a canvas that clips it
  Tips.lay(ctx2d(fresh2), st2, 30, 30, 60, 1.2);
  var fw = ctx2d(fresh2).getImageData(0, 0, 60, 60).data, wOff = 0;
  for (var iw = 0; iw < 3600; iw++) if (Math.abs(fw[iw * 4 + 3] - w2[iw]) > 1) wOff++;
  out.clone.weights = { one: sc1 === sc2, moved: w1.some(function(v, i){ return v !== w2[i]; }), off: wOff };
  // …and a Clone stroke whose turned dab changes size from dab to dab (size jitter) is drawn into
  // that one scratch throughout (4.50 (10)'s review: a canvas for nearly every dab, 38 in 26).
  s = fresh(); set({ size: 120, tip: "square", angle: 30, sizeJit: .6, spacing: .2 }); App.brush.mode = "clone"; brushStamp._key = null;
  Clone.pick(s, 60, 60);
  var shapes = new Set(), sizes = new Set();
  Tips.shape = function(stamp, S){ var c = was.shape.apply(Tips, arguments); shapes.add(c); sizes.add(S); return c; };
  try { line(run(200, 460, 330, 12), 11); } finally { Tips.shape = was.shape; }
  out.clone.scratch = { canvases: shapes.size, sizes: sizes.size };

  // ---- J. the library: loading, IndexedDB, a settings file, removing ----
  var pc = mkCanvas(48, 40), pg = ctx2d(pc);
  pg.fillStyle = "#fff"; pg.fillRect(0, 0, 48, 40); pg.fillStyle = "#000"; pg.beginPath(); pg.arc(24, 20, 12, 0, Math.PI * 2); pg.fill();
  var png = await new Promise(function(r){ pc.toBlob(r, "image/png"); });
  set({});
  await BrushPanel.loadTip(new File([png], "stencil dot.png", { type: "image/png" }));
  var dotId = App.brush.tip, sel = document.getElementById("brushTip");
  out.load = { id: dotId, known: Tips.lib.has(dotId), name: Tips.lib.has(dotId) && Tips.lib.get(dotId).name,
               listed: [].some.call(sel.options, function(o){ return o.value === dotId && o.textContent === "stencil dot"; }) && sel.value === dotId,
               said: document.getElementById("status").textContent,
               del: !document.getElementById("btnTipDel").disabled };
  var fc = mkCanvas(20, 20), fg = ctx2d(fc); fg.fillStyle = "#777"; fg.fillRect(0, 0, 20, 20);
  var flatPng = await new Promise(function(r){ fc.toBlob(r, "image/png"); });
  await BrushPanel.loadTip(new File([flatPng], "flat.png", { type: "image/png" }));
  out.load.flat = { said: document.getElementById("status").textContent, tip: App.brush.tip === dotId };
  var sumWas = Tips.lib.get(dotId).sum;
  Tips.lib.clear(); Tips.ready = false;
  await Tips.load();
  out.idb = { back: Tips.lib.has(dotId) && Tips.lib.get(dotId).sum === sumWas && Tips.lib.has(barId), ready: Tips.ready };
  var fileBlob = JSON.parse(JSON.stringify(prefsBlob(true))), lsBlob = prefsBlob();
  out.file = { inFile: (fileBlob.brush.tipLib || []).some(function(r){ return r.id === dotId && typeof r.cov === "string"; }),
               inLS: !!(lsBlob.brush && "tipLib" in lsBlob.brush), tipRow: fileBlob.brush.tip };
  await Tips.remove(dotId);
  BrushPanel.tipOptions(); BrushPanel.setTip("round");
  applyPrefs(fileBlob);
  out.file.back = Tips.lib.has(dotId) && Tips.lib.get(dotId).sum === sumWas && App.brush.tip === dotId && sel.value === dotId;
  // adopt's IndexedDB write runs behind it: wait for it rather than for a guessed interval, which a
  // loaded machine can outrun.
  var kept = null;
  for (var w = 0; w < 100 && !kept; w++) { kept = await idbGet("tip:" + dotId); if (!kept) await new Promise(function(r){ setTimeout(r, 50); }); }
  out.file.stored = !!kept;
  // Removing it puts every tool that used it back on Round — the one in hand and one waiting.
  BrushTools.row("erase").tip = dotId;
  window.confirm = function(){ return true; };
  await BrushPanel.removeTip();
  window.confirm = was.confirm;
  out.remove = { lib: !Tips.lib.has(dotId), live: App.brush.tip === "round", erase: BrushTools.row("erase").tip === "round",
                 stored: (await idbGet("tip:" + dotId)) == null, listed: [].some.call(sel.options, function(o){ return o.value === dotId; }) };
  // A tool whose stored tip is gone paints Round, and says so rather than quietly changing shape.
  document.getElementById("status").textContent = "";
  BrushPanel.setTip("tgone123");
  out.remove.gone = App.brush.tip === "round" && /not in this browser's tip library/.test(document.getElementById("status").textContent);
  // Two tabs, in the real IndexedDB (4.50 (10)'s review). Tab B read the library before tab A added
  // a tip; B adding one of its own must not write A's out of the index, or A's is gone at the next
  // visit and its record left in IndexedDB with nothing pointing at it.
  var dotRec = { w: 4, h: 4, cov: Uint8Array.from([0,255,255,0, 255,255,255,255, 255,255,255,255, 0,255,255,0]) };
  var idA = await Tips.add(dotRec, "t131 added in tab A");
  Tips.lib.delete(idA);                                          // tab B's memory, from before A added it
  var idB = await Tips.add(dotRec, "t131 added in tab B");
  var rowsAB = ((await idbGet("tipIndex")) || []).map(function(x){ return x.id; });
  Tips.lib.clear(); Tips.ready = false;
  await Tips.load();
  out.tabs = { aKept: rowsAB.indexOf(idA) >= 0, aBack: Tips.lib.has(idA), bBack: Tips.lib.has(idB) };
  await Tips.remove(idA); await Tips.remove(idB);
  BrushPanel.tipOptions();
  // Dark ink on white paper with ONE transparent corner, through the real Load…: the ink is the tip.
  var oc = mkCanvas(64, 64), og = ctx2d(oc);
  og.fillStyle = "#fff"; og.fillRect(0, 0, 64, 64); og.fillStyle = "#000"; og.beginPath(); og.arc(32, 32, 20, 0, Math.PI * 2); og.fill();
  og.clearRect(0, 0, 1, 1);
  var ocPng = await new Promise(function(r){ oc.toBlob(r, "image/png"); });
  await BrushPanel.loadTip(new File([ocPng], "black dot on white.png", { type: "image/png" }));
  var OT = Tips.lib.get(App.brush.tip);
  out.oneClear = OT ? { w: OT.w, h: OT.h, centre: OT.cov[(OT.h >> 1) * OT.w + (OT.w >> 1)], corner: OT.cov[2 * OT.w + 2] } : { none: true };
  if (OT) await Tips.remove(OT.id);
  BrushPanel.tipOptions(); BrushPanel.setTip("round");

  // ---- K. the tool's own; the panel; the recorder; the stamp key ----
  set({});
  applyBrushMode("color");
  BrushPanel.setTip("chip"); BrushTools.put(BrushTools.field("scatter"), .5); BrushTools.put(BrushTools.field("follow"), true);
  applyBrushMode("erase");
  var er = [App.brush.tip, App.brush.scatter, App.brush.follow].join();
  applyBrushMode("color");
  out.tools = { erase: er, colour: [App.brush.tip, App.brush.scatter, App.brush.follow].join(),
                scatterEl: document.getElementById("brushScatter").value, sel: sel.value };
  function vis(id){ return document.getElementById(id).style.display !== "none"; }
  BrushPanel.setTip("round");
  out.rows = { round: [vis("rowHard"), vis("rowAngle"), vis("rowFollow")].join() };
  BrushPanel.setTip("chip");
  out.rows.chip = [vis("rowHard"), vis("rowAngle"), vis("rowFollow")].join();
  BrushPanel.setTip("square");
  out.rows.square = [vis("rowHard"), vis("rowAngle")].join();
  applyBrushMode("height");
  out.rows.height = [vis("rowTip"), vis("brushDyn"), vis("rowHard")].join();
  applyBrushMode("color");
  BrushPanel.setTip("chip"); App.brush.sizeJit = .25;
  var rs = recSettings();
  out.rec = [rs.tip, rs.jitter.join("/"), rs.scatter, rs.follow].join();
  BrushPanel.setTip(barId);
  out.rec += "|" + recSettings().tip;
  App.brush.sizeJit = 0;
  set({ tip: "square", size: 64 });
  var k1 = brushStamp(), k2 = brushStamp();
  App.brush.tip = "chip"; var k3 = brushStamp();
  var covA = Tips._cov && Tips._cov.cov;
  App.brush.color = "#00ff00"; var k4 = brushStamp();
  var covB = Tips._cov && Tips._cov.cov;
  App.brush.tip = barId; var k5 = brushStamp();
  var old = Tips.lib.get(barId), bytes = old.cov.slice(); bytes[0] = bytes[0] ^ 255;
  Tips.lib.set(barId, Tips.record({ id: barId, name: old.name, w: old.w, h: old.h, cov: bytes }));
  var k6 = brushStamp();
  Tips.lib.set(barId, old);
  out.key = { same: k1 === k2, tip: k3 !== k1, colour: k4 !== k3, kept: !!covA && covA === covB, green: ctx2d(k4).getImageData(32, 32, 1, 1).data.join(),
              bytes: k6 !== k5, bar: k5.width + "x" + k5.height };
  // One stamp a stroke, however its dabs vary: the dynamics are applied as each dab is drawn, never
  // baked into the stamp. A per-dab value in its key would make one per stampAt — at 200 texels a
  // Chip's is 3.5 ms, and t47's 48-texel stroke is too small for its bar to notice (tried, 2026-09-26).
  s = fresh(); set({ tip: "chip", size: 200, sizeJit: .5, flowJit: .5, angleJit: .5, scatter: 1, follow: true, spacing: .1 });
  var made = 0, realStamp = Tips.stamp;
  Tips.stamp = function(){ made++; return realStamp.apply(Tips, arguments); };
  try { line(run(40, 470, 256, 15), 3); } finally { Tips.stamp = realStamp; }
  out.once = made;
  // a pen's pressure still sizes a tip's dab
  s = fresh(); set({ tip: "square", size: 40, spacing: .1 });
  beginStroke(false, false);
  for (var j = 0; j <= 20; j++) { stroke.p = .1 + .9 * j / 20; stampAt(60 + 19 * j, 256, 0, null); }
  endStroke();
  out.pen = [80, 200, 330, 440].map(function(x){ return down(layer(), x, 200, 312); });
  // The stamp is made before the first dab needs it (4.50 (10)'s review): drawing the brush outline
  // over the sheet — which the pointer does before any stroke — asks for it, and once the brush has
  // been left alone for WARM_MS it is made. Not inside a stroke. How long the first dab then takes at
  // the largest size is t47's.
  s = fresh(); set({ tip: "chip", size: 300 });
  v2.cursor = { x: 100, y: 100 }; v2.lazy = null; v2.sc = 1;
  var ringC = mkCanvas(200, 200);
  Draw2D.ring(ctx2d(ringC));
  var warmWant = brushStamp.key(App.brush, Tips.get("chip")), warmNow = brushStamp._key === warmWant;
  await new Promise(function(r){ setTimeout(r, brushStamp.WARM_MS + 200); });
  out.warm = { before: warmNow, after: brushStamp._key === warmWant };
  App.brush.size = 280;
  Draw2D.ring(ctx2d(ringC));
  beginStroke(false, false);
  await new Promise(function(r){ setTimeout(r, brushStamp.WARM_MS + 200); });
  out.warm.midStroke = brushStamp._key === brushStamp.key(App.brush, Tips.get("chip"));
  endStroke();
  // The 2-D outline is the Square's square, at its Angle; every other tip's is the circle its Size
  // spans. (The 3-D ring is that circle for every tip — the guide says so.)
  function outlineAt(tip, x, y){ set({ tip: tip, size: 40 }); var oc2 = mkCanvas(200, 200); Draw2D.ring(ctx2d(oc2)); return al(oc2, x, y); }
  out.outline = { squareCorner: outlineAt("square", 119, 119), chipCorner: outlineAt("chip", 119, 119), squareEdge: outlineAt("square", 120, 100), chipEdge: outlineAt("chip", 120, 100) };
  v2.cursor = was.cursor; v2.lazy = was.lazy; v2.sc = was.sc;
  // The ring on the model shows its inner circle — where a soft edge stops being opaque — only for
  // the two tips Hardness shapes. ray3d is handed the seam case's own hit and a group stands in
  // for the model, which this page has not loaded.
  var keepRay = window.ray3d, keepMG = modelGroup;
  window.ray3d = function(){ return seamHit; };
  if (!modelGroup) modelGroup = new THREE.Group();
  function innerRing(tip){ set({ tip: tip, size: 40, hardness: .5 }); updateBrushRing({ clientX: 0, clientY: 0 }); return !!(brushRing && brushRing.visible && brushRing.children[1].visible); }
  try { out.ring = { round: innerRing("round"), square: innerRing("square"), chip: innerRing("chip"), image: innerRing(barId) }; }
  finally { window.ray3d = keepRay; modelGroup = keepMG; hideBrushRing(); }

  } finally {
    if (stroke) endStroke();
    window.confirm = was.confirm; Mirror.texel = was.texel; PathUI.path = was.path;
    window.symEnabled = was.sym; Mirror.bake = was.bake; Tips.shape = was.shape;
    v2.cursor = was.cursor; v2.lazy = was.lazy; v2.sc = was.sc;
    if (barId) await Tips.remove(barId);
    if (typeof dotId === "string" && Tips.lib.has(dotId)) await Tips.remove(dotId);
    FIELDS.forEach(function(k){ App.brush[k] = was[k]; });
    App.brush.mode = was.mode; App.brush.color = was.color; brushStamp._key = null;
    App.brushTools = JSON.parse(was.tools);
    App.activeSlot = was.slot; App.activeLayer = was.layer; App.paint3d = was.p3;
    for (var i2 = 1; i2 <= seq; i2++) App.slots.delete("t131_" + i2);
    App.undoStack.length = 0; App.redoStack.length = 0;
  }
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 800), timeoutMs: 180000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log("\n=== in the page: the Round tip with no dynamics is the stroke it was ===");
R.is(r.round.painted > 20000 && r.round.diff === 0,
  `a Flow 60 %, Hardness 70 stroke through six points is the loop this item replaced, to the byte (${r.round.diff} bytes differ over ${r.round.painted} painted texels)`);

console.log("\n=== a turned tip reaches past half its size ===");
R.is(r.turn.c1 >= 120 && r.turn.c1 <= 135,
  `a 100-texel Square at 45° lays its corner across the 256 tile edge (alpha ${r.turn.c1} at Opacity 50 %) — unturned it stops short of it (${r.turn.flat})`);
R.is(r.turn.c2 === r.turn.c1, `and the next stroke in that tile does not lay the corner again from a stale buffer (${r.turn.c1} → ${r.turn.c2})`);
R.is(r.turn.changed && r.turn.back, "and undo takes both strokes off, to the byte");

console.log("\n=== Angle follows the stroke ===");
R.is(r.bar.w === 64 && r.bar.h === 8, `a 64 × 8 bar drawn on paper is read as a 64 × 8 tip (${r.bar.w} × ${r.bar.h})`);
R.is(r.bar.off >= 60 && r.bar.off <= 68 && r.bar.on >= 6 && r.bar.on <= 12 && r.bar.onDown >= 290,
  `laid down a vertical stroke it paints ${r.bar.off} texels across as it is, and ${r.bar.on} across when it follows the stroke — turned to run along it, unbroken for ${r.bar.onDown} of 300 texels`);
R.is(r.along.plain.off === 255 && r.along.follow.off === 0 && r.along.plain.mid === 255 && r.along.follow.mid === 255,
  `Stamp along a diagonal path turns each Square to the path when it follows: a texel 25 off the path is under every upright stamp (${r.along.plain.off}) and outside every turned one (${r.along.follow.off})`);
R.is(near(Math.abs(r.mirror.east), Math.PI, 1e-9) && near(r.mirror.south, Math.PI / 2, 1e-9) && r.mirror.none === null,
  `the mirrored copy's heading is the stroke's reflected — east is west across a vertical mirror, south stays south — and none where nothing reflects`);
R.is(r.mirror.along.lit > 2000 && r.mirror.along.mismatch === 0 && r.mirror.free.lit > 2000 && r.mirror.free.mismatch === 0,
  `through Mirror.stamp, Stamp along's copy of a row of turned Squares is the row's reflection texel for texel (${r.mirror.along.mismatch} of ${r.mirror.along.lit} differ), and so is a freehand stroke's (${r.mirror.free.mismatch} of ${r.mirror.free.lit})`);
R.is(r.mirror.leap.diag >= 128 && r.mirror.leap.across < 64 && r.mirror.leap.up < 64,
  `where a freehand copy leaps to another island, its first dab there already runs the copy's new way — a bar along the diagonal (${r.mirror.leap.diag}), not across (${r.mirror.leap.across}) nor the way it ran before the leap (${r.mirror.leap.up})`);
R.is(r.seam.down >= 56 && r.seam.across <= 14 && r.seam.eastOnA >= 150,
  `a 3-D stroke's first dab past a UV seam faces the way the stroke moves on the new island: running east on one island and north on the next, the bar at ${r.seam.at} stands ${r.seam.down} texels tall and ${r.seam.across} across (east along the first island: ${r.seam.eastOnA})`);

console.log("\n=== the dynamics on the sheet ===");
R.is(r.scatter.offLine > 200 && r.scatter.reach <= 41,
  `scatter 200 % lays dabs off a 16-texel stroke (${r.scatter.offLine} texels beyond its edge), never further than twice their size plus their radius (${r.scatter.reach} of 40)`);
R.is(r.scatter.again && r.scatter.other, "the same seed lays the same stroke to the byte, another seed another");
R.is(r.scatter.back, "and a scattered stroke comes off with one undo — the dabs off the line were recorded where they landed");
const J = r.jit;
console.log(`   heights  plain ${J.plain.h.join(" ")}\n            jitter ${J.size.h.join(" ")}\n   centres  plain ${J.plain.c.join(" ")}\n            jitter ${J.flow.c.join(" ")}`);
R.is(J.plain.h.every(v => v === 30) && Math.min(...J.size.h) < 20 && Math.max(...J.size.h) >= 26 && J.size.h.every(v => v >= 5 && v <= 30),
  `size jitter 80 %: a row of 30-texel Squares comes out ${Math.min(...J.size.h)}–${Math.max(...J.size.h)} tall, where without it every one is 30`);
R.is(J.plain.c.every(v => v === 255) && Math.min(...J.flow.c) < 180 && J.flow.c.every(v => v >= 50),
  `flow jitter 80 %: their centres lay ${Math.min(...J.flow.c)}–${Math.max(...J.flow.c)}, where without it every one lays 255`);
R.is(J.anglePlain.split("/")[0] === "0" && +J.angle.split("/")[0] >= 3,
  `angle jitter 100 %: a Square's corner is bare on ${J.angle} dabs turned at random, and on ${J.anglePlain} without it`);
const PW = r.pen;
R.is(PW.every((v, i) => i === 0 || v >= PW[i - 1]) && PW[0] <= 16 && PW[3] >= 36, `a pen's pressure still sizes a tip's dab: a Square widens with it (${PW.join(" ")})`);

console.log("\n=== the masked branch and the Clone ===");
R.is(r.mask.leak === 0 && r.mask.covB > 2000 && Math.abs(r.mask.covA - r.mask.covB) <= r.mask.covB * .01 && Math.abs(r.mask.rowsA - r.mask.rowsB) <= 1,
  `a layer limited to the right half clips a turned Square as it clips a round dab: nothing left of the limit (${r.mask.leak}), and inside it the texels and the rows of a stroke with no limit, corners and all (${r.mask.covA} / ${r.mask.covB} texels, ${r.mask.rowsA} / ${r.mask.rowsB} rows)`);
R.is(r.clone.centre === 255 && r.clone.corner === 0, `the Clone copies in the tip's shape: a Chip's centre (${r.clone.centre}) and not the corner of its square (${r.clone.corner})`);
R.is(!r.clone.threw && r.clone.off === "-200,-200",
  r.clone.threw ? "the Clone threw with a turned, scattered tip and Match tone: " + r.clone.threw
    : `and with a turned, scattered tip and Match tone its offset is fixed where the brush was, not where the first dab was thrown (${r.clone.off}; want -200,-200)`);
R.is(!r.clone.tile.threw && r.clone.tile.dab > 516 && r.clone.tile.off === "-400,-200",
  r.clone.tile.threw ? "the Clone threw on a camouflage tile: " + r.clone.tile.threw
    : `on a camouflage tile too, a dab thrown past the right edge (to x = ${r.clone.tile.dab && r.clone.tile.dab.toFixed(1)}) fixes the offset where the brush is inside the sheet (${r.clone.tile.off}; want -400,-200 — a tile's width off, 112,-200, reads the same texels and draws the ring on the next copy)`);
R.is(r.clone.turned.inside >= 200 && r.clone.turned.corner === 0,
  `the Clone lays a TURNED tip turned: a Square at 45° covers a texel of its diamond outside the upright square (${r.clone.turned.inside}) and not the upright square's corner (${r.clone.turned.corner})`);
R.is(r.clone.weights.one && r.clone.weights.moved && r.clone.weights.off === 0,
  `a turned dab is redrawn into one scratch, and the Clone's tone weights follow each redraw of it rather than its identity (${r.clone.weights.off} texels off the dab drawn afresh)`);
R.is(r.clone.scratch.canvases === 1 && r.clone.scratch.sizes >= 3,
  `a Clone stroke whose turned dab changes size from dab to dab draws every dab into that one scratch (${r.clone.scratch.canvases} canvas for ${r.clone.scratch.sizes} sizes) — §3.6`);

console.log("\n=== the tip library ===");
const Lo = r.load;
R.is(Lo.known && Lo.name === "stencil dot" && Lo.listed && Lo.del && /is a brush tip now/.test(Lo.said),
  `an image file becomes a tip: in the library as “${Lo.name}”, listed and picked, removable, and the status says so`);
R.is(/nothing on it to use/.test(Lo.flat.said) && Lo.flat.tip, "a flat image is refused in words, and the tip in hand is left as it was");
R.is(r.idb.back && r.idb.ready, "the library is kept in IndexedDB: read back after the page forgets it, to the byte");
R.is(r.file.inFile && !r.file.inLS && r.file.tipRow === r.load.id,
  "a settings file carries the tips as base64 beside the tip in hand; the localStorage copy written every four seconds does not");
R.is(r.file.back && r.file.stored, "a settings file brings a removed tip back — into the library, into IndexedDB, and into the brush that named it");
const Rm = r.remove;
R.is(Rm.lib && Rm.live && Rm.erase && Rm.stored && !Rm.listed,
  "removing a tip takes it out of the library, IndexedDB and the list, and every tool that used it — the one in hand and one waiting — goes back to Round");
R.is(Rm.gone, "a tool whose stored tip is not in the library paints Round and says so");
R.is(r.tabs.aKept && r.tabs.aBack && r.tabs.bBack,
  "a second tab that adds a tip keeps the first tab's in IndexedDB's index, and the next visit has both — the index is read before it is written, not rebuilt from the page's memory");
const OC = r.oneClear;
R.is(OC.w === 40 && OC.h === 40 && OC.centre === 255 && OC.corner === 0,
  `a black dot on white paper with one transparent corner, through Load…, is the dot: cropped to it (${OC.w} × ${OC.h}), its centre all of it (${OC.centre}) and the paper none (${OC.corner})`);

console.log("\n=== the tool's own; the panel; the recorder; the stamp ===");
R.is(r.tools.erase === "round,0,false" && r.tools.colour === "chip,0.5,true" && r.tools.scatterEl === "50" && r.tools.sel === "chip",
  `the tip and its dynamics are the tool's: set on the colour brush, fresh on the eraser (${r.tools.erase}), back on the colour brush (${r.tools.colour})`);
R.is(r.rows.round === "true,false,false" && r.rows.chip === "false,true,true" && r.rows.square === "true,true" && r.rows.height === "false,false,true",
  `the panel shows Hardness for Round and Square, the angle rows for a tip that turns, and neither the tip nor its dynamics for Panel line (${JSON.stringify(r.rows)})`);
R.is(r.rec === "chip,0.25/0/0,0.5,true|image", `the recorder logs the tip and how dabs varied — a loaded tip as "image", never its file's name (${r.rec})`);
const K = r.key;
R.is(K.same && K.tip && K.colour && K.bytes, "the stamp is cached, and redrawn for a new tip, a new colour, and new bytes under a tip's old id");
R.is(K.kept && K.green === "0,255,0,255", "a new colour recolours the tip's coverage rather than making it again");
R.is(K.bar === "64x8", `and an image tip's stamp keeps its proportions, its longer side the brush Size (${K.bar})`);
R.is(r.once === 1, `a stroke of 29 jittered, scattered, turned 200-texel Chips makes its stamp once (${r.once}) — what varies is applied as each dab is drawn`);
R.is(!r.warm.before && r.warm.after && !r.warm.midStroke,
  `drawing the brush outline asks for the stamp, and it is made once the brush has been still for a moment — not at once, and not in the middle of a stroke (${JSON.stringify(r.warm)})`);
const OL = r.outline;
R.is(OL.squareCorner > 0 && OL.chipCorner === 0 && OL.squareEdge > 0 && OL.chipEdge > 0,
  `the 2-D outline is the Square's square — through its corner (${OL.squareCorner}) — and every other tip's circle, which passes nowhere near that corner (${OL.chipCorner})`);
R.is(r.ring.round && r.ring.square && !r.ring.chip && !r.ring.image,
  `the ring on the model shows its inner circle at Hardness 50 for Round and Square only — not for a Chip or an image tip, which carry their own edge (${JSON.stringify(r.ring)})`);

const errs = (r.__errs || []).filter(e => !/net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
