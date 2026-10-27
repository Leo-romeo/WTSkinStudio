// Golden fixtures for the ENCODE half of the pipeline — the code that produces the user's
// published skin. Every decoder has a test (t23); until now none of these did, and Phase 1.3 of
// ROADMAP.md moves all of them into a worker.
//
// Two independent kinds of check, because a golden file on its own only proves "unchanged", not
// "correct":
//
//   1. SEMANTIC — round trips and invariants that would still hold if the code were rewritten:
//      BCnEnc.encodeBC3 -> the page's own BCnDec.decodeBCn reproduces a solid block exactly; BCnEnc.writeDDS -> DDS.parseDDS
//      reads back the dimensions, format and full mip chain it wrote; writeTGA's header fields and
//      BGRA order; BCnEnc.buildMips' level count and halving; BCnEnc.renormalizeWTNormal never leaving a normal
//      longer than unit and never touching R or B; padSeams never writing inside the mask and
//      stopping at maxDist rings.
//   2. GOLDEN — SHA-256 per case against tools/fixtures/encode.golden.json, so any drift in the
//      exact bytes is caught even where it is still "valid". Small cases carry their full bytes
//      inline so a failure is diagnosable rather than just a hash mismatch.
//
// Inputs are chosen for the hazards CLAUDE.md §3 records, not for coverage-by-volume: a THREE-hue
// block (a decal edge keyed off its background — the case that breaks BC1's one-line palette and
// that the principal-axis endpoint selection exists for), a flat block (the power-iteration
// `L < 1e-9` break), constant alpha (BCnEnc.encodeBC4AlphaBlock's mn===mx branch), and sizes that are not
// multiples of four (the block-padding clamp).
//
// Usage: node tools/t29_encode.mjs [git-rev]     compare current page against a revision too
//        node tools/t29_encode.mjs --update      rewrite the golden file
// Needs no game install.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GOLDEN = path.join(ROOT, "tools", "fixtures", "encode.golden.json");
const args = process.argv.slice(2);
const UPDATE = args.includes("--update");
const REV = args.find(a => !a.startsWith("-")) || null;

// ---------------------------------------------------------------- lift the page's own code
// The codecs layer is three sections since ROADMAP 2.2: DDS is the container, BCNDEC the block
// decoders (the round trips below decode what they encode), BCNENC buildMips /
// renormalizeWTNormal / writeDDS / encodeBC3 and the two block encoders. writeTGA and padSeams
// live out in the export code and are pulled by name.
const CODECS = ["DDS", "BCNDEC", "BCNENC"];
const sectionOf = (src, n) => {
  const a = src.search(new RegExp("[\\n>]/\\*==" + n + "==\\*/")), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("no " + n + " section");
  return src.slice(a + 1, b);
};
const fnOf = (src, name) => {
  const i = src.indexOf("\nfunction " + name + "(");
  if (i < 0) throw new Error("not found: " + name);
  let d = 0;
  for (let p = src.indexOf("{", i); p < src.length; p++) {
    if (src[p] === "{") d++;
    else if (src[p] === "}") { d--; if (!d) return src.slice(i + 1, p + 1); }
  }
  throw new Error("unbalanced: " + name);
};
// [namespace, name]: each codec function through its module's namespace since ROADMAP 2.3, or bare
// in a revision from before it, so the golden comparison against HEAD~ still lifts both. writeTGA
// and padSeams are not codecs and stay bare.
const EXPORTS = [["BCnEnc", "buildMips"], ["BCnEnc", "reduce"], ["BCnEnc", "renormalizeWTNormal"], ["BCnEnc", "writeDDS"], ["BCnEnc", "encodeBC3"],
  ["BCnEnc", "encodeBC4AlphaBlock"], ["BCnEnc", "encodeBC1ColorBlock"], [null, "writeTGA"], [null, "padSeams"],
  ["DDS", "parseDDS"], ["BCnDec", "decodeBCn"], ["BCnEnc", "to565"], ["BCnDec", "c565"]];
const load = (src, tag) => {
  const body = CODECS.map(n => sectionOf(src, n)).join("\n").replace(/^"use strict";$/m, "") +
    "\n" + fnOf(src, "writeTGA") + "\n" + fnOf(src, "padSeams");
  const m = new Function(body + "\nreturn {" + EXPORTS.map(([ns, n]) => ns ? n + ": typeof " + ns + " !== \"undefined\" ? " + ns + "." + n + " : " + n : n).join(",") + "};")();
  m.tag = tag;
  return m;
};
const cur = load(fs.readFileSync(path.join(ROOT, "wt_skin_studio.html"), "utf8"), "current");

// ---------------------------------------------------------------- harness
let checks = 0, fails = 0;
const ok = m => { checks++; console.log("  ok   " + m); };
const fail = m => { checks++; fails++; console.log("  FAIL " + m); };
const is = (cond, m) => cond ? ok(m) : fail(m);
const sha = b => crypto.createHash("sha256").update(Buffer.from(b.buffer || b, b.byteOffset || 0, b.byteLength ?? b.length)).digest("hex");

const golden = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, "utf8")) : { cases: {} };
const fresh = { note: "Golden bytes for the export encoders. Regenerate with: node tools/t29_encode.mjs --update", cases: {} };
const HEX_INLINE = 256;                                   // keep small cases fully readable in the file

function record(name, bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer || bytes);
  const entry = { len: u8.length, sha: sha(u8) };
  if (u8.length <= HEX_INLINE) entry.hex = Buffer.from(u8).toString("hex");
  fresh.cases[name] = entry;
  if (UPDATE) return;
  const want = golden.cases[name];
  if (!want) { fail(`golden ${name}: no baseline (run with --update)`); return; }
  if (want.len !== entry.len) { fail(`golden ${name}: length ${entry.len}, expected ${want.len}`); return; }
  if (want.sha !== entry.sha) {
    let where = "";
    if (want.hex) {
      const w = Buffer.from(want.hex, "hex");
      for (let i = 0; i < w.length; i++) if (w[i] !== u8[i]) { where = ` — first difference at byte ${i}: ${u8[i]} vs ${w[i]}`; break; }
    }
    fail(`golden ${name}: bytes changed${where}`);
    return;
  }
  ok(`golden ${name} (${entry.len} bytes)`);
}

// deterministic PRNG — a failure has to be reproducible
let seed = 0x51f3c7d;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

// ---------------------------------------------------------------- fixtures
// Three hues in one 4x4 block: base texture, marking, and the leftover halo of a keyed-out
// background. This is the case CLAUDE.md §3 measured (olive decoding as red) and the reason the
// endpoints follow the principal axis instead of the luminance extremes.
function threeHueBlock() {
  const px = new Uint8Array(64);
  const hues = [[110, 120, 82, 255], [200, 40, 35, 255], [12, 10, 14, 128]];
  for (let i = 0; i < 16; i++) {
    const h = hues[i < 6 ? 0 : i < 12 ? 1 : 2];
    px.set(h, i * 4);
  }
  return px;
}
const flatBlock = (r, g, b, a) => { const px = new Uint8Array(64); for (let i = 0; i < 16; i++) px.set([r, g, b, a], i * 4); return px; };
const rampBlock = () => { const px = new Uint8Array(64); for (let i = 0; i < 16; i++) px.set([i * 17, 255 - i * 17, 128, i * 17], i * 4); return px; };

// A patchwork image: solid regions, a hard two-colour edge, a noise field and a gradient. Uniform
// noise alone would never exercise the flat-block or hard-edge paths.
function testImage(w, h) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const q = (y < h / 2 ? 0 : 2) + (x < w / 2 ? 0 : 1);
    if (q === 0) { a[i] = 110; a[i + 1] = 120; a[i + 2] = 82; a[i + 3] = 255; }
    else if (q === 1) { const on = x > w * 0.7; a[i] = on ? 200 : 110; a[i + 1] = on ? 40 : 120; a[i + 2] = on ? 35 : 82; a[i + 3] = on ? 255 : 0; }
    else if (q === 2) { a[i] = (rnd() * 256) | 0; a[i + 1] = (rnd() * 256) | 0; a[i + 2] = (rnd() * 256) | 0; a[i + 3] = (rnd() * 256) | 0; }
    else { a[i] = (x * 255 / w) | 0; a[i + 1] = (y * 255 / h) | 0; a[i + 2] = 64; a[i + 3] = 255; }
  }
  return a;
}
// A WT packed normal sheet: R = inverted roughness, G = normal Y, B = metallicity, A = normal X
// (CLAUDE.md §1; renormalising treats the two alike, so the order does not matter here). Deliberately includes vectors longer than unit so renormalize has work to do.
function normalImage(w, h) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    a[i] = (x * 255 / w) | 0;
    a[i + 1] = Math.round((Math.sin(x * 0.4) * 1.3 + 1) * 127.5);   // |x| can exceed 1
    a[i + 2] = y < h / 2 ? 0 : 255;
    a[i + 3] = Math.round((Math.cos(y * 0.4) * 1.3 + 1) * 127.5);
  }
  return a;
}

console.log("=== block encoders ===");
{
  const cases = [["three-hue", threeHueBlock()], ["flat", flatBlock(110, 120, 82, 255)],
    ["flat-alpha0", flatBlock(9, 9, 9, 0)], ["ramp", rampBlock()]];
  for (const [name, px] of cases) {
    const out = new Uint8Array(16);
    cur.encodeBC4AlphaBlock(px, out, 0);
    cur.encodeBC1ColorBlock(px, out, 8);
    record("bc3block/" + name, out);
  }
  // mn === mx: the constant-alpha short circuit must emit zero index bits
  const out = new Uint8Array(8);
  cur.encodeBC4AlphaBlock(flatBlock(1, 2, 3, 200), out, 0);
  is(out[0] === 200 && out[1] === 200 && out.slice(2).every(v => v === 0),
    "constant alpha emits both endpoints 200 and no index bits");
  // A flat block must survive a round trip EXACTLY — the `L < 1e-9` power-iteration break must not
  // corrupt it. "Exactly" is only a meaningful thing to ask of a colour 5:6:5 can represent: the
  // decoder expands a channel as v*255/31 (255/63 for green), so only 32 (resp. 64) of the 256
  // 8-bit values are fixed points. Land on one first, or the test is measuring quantisation.
  const fix5 = v => Math.round((v >> 3) * 255 / 31), fix6 = v => Math.round((v >> 2) * 255 / 63);
  const SOLID = [fix5(96), fix6(160), fix5(32), 255];             // -> 99, 162, 33
  {
    const px = flatBlock(...SOLID), blk = new Uint8Array(16);
    cur.encodeBC4AlphaBlock(px, blk, 0);
    cur.encodeBC1ColorBlock(px, blk, 8);
    const back = cur.decodeBCn(blk, 4, 4, "DXT5");
    is(back[0] === SOLID[0] && back[1] === SOLID[1] && back[2] === SOLID[2] && back[3] === 255,
      `flat block round trips exactly (${back[0]},${back[1]},${back[2]},${back[3]} == ${SOLID.join(",")})`);
  }
  // The three-hue block is the known-lossy case, and the number in CLAUDE.md §3 (worst channel
  // error 106 -> 66) belongs to one measured texture, not to any three-hue block — so asserting a
  // fixed threshold here would only be asserting this fixture. What IS a property of the code is
  // the claim the comment on BCnEnc.encodeBC1ColorBlock makes: principal-axis endpoints beat luminance
  // extremes. So the luminance version is built here and the two are compared directly.
  {
    const px = threeHueBlock();
    const lumaEndpoints = (px, out, o) => {
      let mnI = 0, mxI = 0, lo = 1e9, hi = -1e9;
      for (let i = 0; i < 16; i++) {
        const L = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
        if (L < lo) { lo = L; mnI = i; }
        if (L > hi) { hi = L; mxI = i; }
      }
      let c0 = cur.to565(px[mxI * 4], px[mxI * 4 + 1], px[mxI * 4 + 2]);
      let c1 = cur.to565(px[mnI * 4], px[mnI * 4 + 1], px[mnI * 4 + 2]);
      if (c0 < c1) { const t = c0; c0 = c1; c1 = t; }
      if (c0 === c1 && c0 < 0xffff) c0++;
      out[o] = c0 & 255; out[o + 1] = c0 >> 8; out[o + 2] = c1 & 255; out[o + 3] = c1 >> 8;
      const p0 = cur.c565(c0), p1 = cur.c565(c1);
      const cols = [p0, p1, [(2 * p0[0] + p1[0]) / 3, (2 * p0[1] + p1[1]) / 3, (2 * p0[2] + p1[2]) / 3],
        [(p0[0] + 2 * p1[0]) / 3, (p0[1] + 2 * p1[1]) / 3, (p0[2] + 2 * p1[2]) / 3]];
      let bits = 0;
      for (let i = 0; i < 16; i++) {
        let best = 0, bd = 1e9;
        for (let j = 0; j < 4; j++) {
          const dr = cols[j][0] - px[i * 4], dg = cols[j][1] - px[i * 4 + 1], db = cols[j][2] - px[i * 4 + 2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bd) { bd = d; best = j; }
        }
        bits |= best << (i * 2);
      }
      out[o + 4] = bits & 255; out[o + 5] = (bits >>> 8) & 255; out[o + 6] = (bits >>> 16) & 255; out[o + 7] = (bits >>> 24) & 255;
    };
    const worstOf = enc => {
      const blk = new Uint8Array(16);
      cur.encodeBC4AlphaBlock(px, blk, 0);
      enc(px, blk, 8);
      const back = cur.decodeBCn(blk, 4, 4, "DXT5");
      let w = 0;
      for (let i = 0; i < 16; i++) for (let c = 0; c < 3; c++) w = Math.max(w, Math.abs(back[i * 4 + c] - px[i * 4 + c]));
      return w;
    };
    const axis = worstOf(cur.encodeBC1ColorBlock), luma = worstOf(lumaEndpoints);
    is(axis < luma, `three-hue block: principal-axis endpoints beat luminance extremes (worst channel error ${axis} vs ${luma})`);
  }
}

console.log("=== BCnEnc.encodeBC3 ===");
for (const [w, h] of [[4, 4], [64, 64], [130, 66], [1, 1], [7, 3]]) {
  const img = testImage(w, h);
  const out = cur.encodeBC3(img, w, h);
  const bw = Math.max(1, (w + 3) >> 2), bh = Math.max(1, (h + 3) >> 2);
  is(out.length === bw * bh * 16, `BCnEnc.encodeBC3 ${w}x${h} -> ${out.length} bytes (${bw}x${bh} blocks)`);
  record(`encodeBC3/${w}x${h}`, out);
}
// A solid opaque sheet must come back bit-exact at every texel, partial edge blocks included —
// this is what proves the clamp that pads a 7x3 image out to two whole 4x4 blocks is right.
{
  const w = 7, h = 3, img = new Uint8ClampedArray(w * h * 4);
  const S = [Math.round((96 >> 3) * 255 / 31), Math.round((160 >> 2) * 255 / 63), Math.round((32 >> 3) * 255 / 31), 255];
  for (let i = 0; i < w * h; i++) img.set(S, i * 4);
  const back = cur.decodeBCn(cur.encodeBC3(img, w, h), w, h, "DXT5");
  let bad = -1;
  for (let i = 0; i < w * h && bad < 0; i++)
    if (back[i * 4] !== S[0] || back[i * 4 + 1] !== S[1] || back[i * 4 + 2] !== S[2] || back[i * 4 + 3] !== 255) bad = i;
  is(bad < 0, `solid ${w}x${h} sheet round trips exactly through partial edge blocks` + (bad < 0 ? "" : ` (texel ${bad})`));
}

console.log("=== BCnEnc.buildMips / BCnEnc.renormalizeWTNormal ===");
{
  const w = 64, h = 64, img = testImage(w, h);
  const mips = cur.buildMips(img, w, h, false);
  is(mips.length === 7, `BCnEnc.buildMips 64x64 -> ${mips.length} levels (expect 7, down to 1x1)`);
  is(mips[0].rgba === img, "BCnEnc.buildMips level 0 aliases the source array (no copy)");
  is(mips.every((m, i) => m.w === Math.max(1, w >> i) && m.h === Math.max(1, h >> i)), "every level halves");
  for (const m of mips) record(`buildMips/64x64/L${Math.log2(w / m.w) | 0}`, m.rgba);

  // non-square, non-power-of-two: the chain must terminate at 1x1 without an infinite loop
  const odd = cur.buildMips(testImage(13, 5), 13, 5, false);
  is(odd[odd.length - 1].w === 1 && odd[odd.length - 1].h === 1, `BCnEnc.buildMips 13x5 terminates at 1x1 in ${odd.length} levels`);

  // The renorm path has a contract that is easy to misread: BCnEnc.buildMips renormalises the levels it
  // GENERATES and deliberately leaves level 0 alone, because level 0 is the sheet the user
  // authored and aliasing it (see above) means normalising it would silently rewrite their
  // pixels. Box-filtering two opposing normals shortens the result, which is what levels >= 1 are
  // being corrected for. Both halves are asserted so neither can drift unnoticed.
  const nrm = normalImage(32, 32);
  const before = nrm.slice();
  const nmips = cur.buildMips(nrm, 32, 32, true);
  const longestIn = m => {
    let L = 0;
    for (let i = 0; i < m.rgba.length; i += 4) L = Math.max(L, Math.hypot(m.rgba[i + 1] / 127.5 - 1, m.rgba[i + 3] / 127.5 - 1));
    return L;
  };
  let longest = 0;
  for (let i = 1; i < nmips.length; i++) longest = Math.max(longest, longestIn(nmips[i]));
  is(longest <= 1 + 1 / 127.5, `BCnEnc.buildMips renorm: generated levels never exceed unit length (longest ${longest.toFixed(4)})`);
  is(nmips[0].rgba.every((v, i) => v === before[i]),
    `BCnEnc.buildMips renorm: level 0 is left exactly as authored (longest there ${longestIn(nmips[0]).toFixed(4)}, unnormalised by design)`);
  for (const m of nmips) record(`buildMipsN/32x32/L${Math.log2(32 / m.w) | 0}`, m.rgba);

  // Restarts (ROADMAP 4.58): a level handed in IS that level, and the levels below it come from it
  // exactly as they come from level 0. `reduce(r)` is the chain's level r — what the export makes a
  // restart's full-size sheet into — so a restart that is the generated level changes nothing.
  // Its own images, and the PRNG put back after them: every case below draws from the same sequence,
  // and its goldens were captured without these.
  const seedWas = seed;
  {
    const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const refused = f => { try { f(); return false; } catch (e) { return true; } };
    const plain = cur.buildMips(img.slice(), w, h, false), other = testImage(16, 16);
    const red2 = cur.reduce(img.slice(), w, h, false, 2);
    is(red2.w === 16 && red2.h === 16 && eq(red2.rgba, plain[2].rgba), "BCnEnc.reduce(…, 2) is the chain's level 2, byte for byte");
    const same = cur.buildMips(img.slice(), w, h, false, [{ level: 2, rgba: red2.rgba }]);
    is(same.length === plain.length && same.every((m, i) => eq(m.rgba, plain[i].rgba)), "a restart that is the generated level changes no level of the chain");
    const own = cur.buildMips(img.slice(), w, h, false, [{ level: 2, rgba: other }]);
    const want3 = cur.reduce(other.slice(), 16, 16, false, 1).rgba;
    is(own[2].rgba === other && eq(own[1].rgba, plain[1].rgba) && eq(own[3].rgba, want3) && !eq(own[3].rgba, plain[3].rgba),
      "a restart at 2 is level 2, level 1 is untouched, and level 3 is generated from the restart, not from level 0");
    for (const m of own) record(`buildMipsRestart/64x64@2/L${Math.log2(w / m.w) | 0}`, m.rgba);
    const nAll = normalImage(32, 32);
    is(eq(cur.reduce(nAll.slice(), 32, 32, true, 2).rgba, cur.buildMips(nAll.slice(), 32, 32, true)[2].rgba), "renorm: BCnEnc.reduce(…, 2) is the renormalised chain's level 2 too");
    const nOwn = normalImage(8, 8), nm = cur.buildMips(normalImage(32, 32), 32, 32, true, [{ level: 2, rgba: nOwn }]);
    let nl = 0;
    for (let i = 3; i < nm.length; i++) nl = Math.max(nl, longestIn(nm[i]));
    is(nm[2].rgba === nOwn && nl <= 1 + 1 / 127.5, `renorm: the levels after a restart are renormalised too (longest ${nl.toFixed(4)}); the restart itself is passed through`);
    is(refused(() => cur.buildMips(img.slice(), w, h, false, [{ level: 2, rgba: new Uint8ClampedArray(4) }])), "a restart of the wrong size is refused");
    is(refused(() => cur.buildMips(img.slice(), w, h, false, [{ level: 9, rgba: other }])), "a restart past the chain's end is refused");
  }
  seed = seedWas;

  // the standalone call, on its own copy, so the golden is of the function and not of the chain
  const solo = normalImage(16, 16), soloBefore = solo.slice();
  cur.renormalizeWTNormal(solo);
  let rbMoved = 0, stillLong = 0;
  for (let i = 0; i < solo.length; i += 4) {
    if (solo[i] !== soloBefore[i] || solo[i + 2] !== soloBefore[i + 2]) rbMoved++;
    if (Math.hypot(solo[i + 1] / 127.5 - 1, solo[i + 3] / 127.5 - 1) > 1 + 1 / 127.5) stillLong++;
  }
  is(rbMoved === 0, "BCnEnc.renormalizeWTNormal leaves R (inverted roughness) and B (metallicity) untouched");
  is(stillLong === 0, "BCnEnc.renormalizeWTNormal clamps every normal to unit length");
  record("renormalizeWTNormal/16x16", solo);
}

console.log("=== BCnEnc.writeDDS ===");
for (const bc3 of [true, false]) {
  const w = 64, h = 64;
  const mips = cur.buildMips(testImage(w, h), w, h, false);
  const dds = cur.writeDDS(mips, { bc3 });
  const dv = new DataView(dds.buffer, dds.byteOffset, dds.byteLength);
  const label = bc3 ? "DXT5" : "BGRA8";
  is(dv.getUint32(0, true) === 0x20534444, `${label}: DDS magic`);
  is(dv.getUint32(12, true) === h && dv.getUint32(16, true) === w, `${label}: ${w}x${h} in header`);
  is(dv.getUint32(28, true) === mips.length, `${label}: mip count ${dv.getUint32(28, true)}`);
  is((dv.getUint32(108, true) & 0x400000) !== 0, `${label}: DDSCAPS_MIPMAP set`);
  const fourCC = String.fromCharCode(dv.getUint8(84), dv.getUint8(85), dv.getUint8(86), dv.getUint8(87));
  is(bc3 ? fourCC === "DXT5" : (dv.getUint32(80, true) & 0x40) !== 0, `${label}: pixel format (${bc3 ? fourCC : "0x" + dv.getUint32(80, true).toString(16)})`);
  // round trip through the page's own reader — the only end-to-end proof the payload layout is right
  const parsed = cur.parseDDS(dds.buffer.slice(dds.byteOffset, dds.byteOffset + dds.byteLength));
  is(parsed.width === w && parsed.height === h && parsed.mips.length === mips.length,
    `${label}: DDS.parseDDS reads back ${parsed.width}x${parsed.height}, ${parsed.mips.length} mips`);
  if (!bc3) {
    // BGRA8 is lossless, so every level must come back identical texel for texel
    let bad = -1;
    for (let m = 0; m < mips.length && bad < 0; m++)
      for (let i = 0; i < mips[m].rgba.length; i++)
        if (mips[m].rgba[i] !== parsed.mips[m].rgba[i]) { bad = m; break; }
    is(bad < 0, "BGRA8: every mip level round trips byte-exact" + (bad < 0 ? "" : ` (level ${bad} differs)`));
  }
  record(`writeDDS/${label}/64x64`, dds);
}
// single level: no mip flags, no mip count
{
  const dds = cur.writeDDS([{ w: 8, h: 8, rgba: testImage(8, 8) }], { bc3: true });
  const dv = new DataView(dds.buffer, dds.byteOffset, dds.byteLength);
  is(dv.getUint32(28, true) === 0 && (dv.getUint32(8, true) & 0x20000) === 0, "single-level DDS writes no mip count and no mip flag");
  record("writeDDS/DXT5/8x8-nomip", dds);
}

console.log("=== writeTGA ===");
{
  const w = 32, h = 16, img = testImage(w, h);
  const tga = cur.writeTGA(img, w, h);
  is(tga.length === 18 + w * h * 4, `writeTGA ${w}x${h} -> ${tga.length} bytes`);
  is(tga[2] === 2, "image type 2 (uncompressed true colour)");
  is((tga[12] | (tga[13] << 8)) === w && (tga[14] | (tga[15] << 8)) === h, "dimensions little-endian in header");
  is(tga[16] === 32 && tga[17] === 0x28, "32 bpp, 8 alpha bits, top-left origin");
  // BGRA order, first texel
  is(tga[18] === img[2] && tga[19] === img[1] && tga[20] === img[0] && tga[21] === img[3], "first texel written B,G,R,A");
  let bad = -1;
  for (let i = 0; i < w * h && bad < 0; i++) {
    const p = 18 + i * 4;
    if (tga[p] !== img[i * 4 + 2] || tga[p + 1] !== img[i * 4 + 1] || tga[p + 2] !== img[i * 4] || tga[p + 3] !== img[i * 4 + 3]) bad = i;
  }
  is(bad < 0, "every texel is BGRA and lossless" + (bad < 0 ? "" : ` (texel ${bad})`));
  record(`writeTGA/${w}x${h}`, tga);
}

console.log("=== padSeams ===");
{
  // a mask with a hole and a border, so both the inward and outward frontier are exercised
  const w = 32, h = 32;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    mask[y * w + x] = (x >= 6 && x < 26 && y >= 6 && y < 26 && !(x >= 14 && x < 18 && y >= 14 && y < 18)) ? 1 : 0;
  const base = testImage(w, h);

  // a texel inside the mask must never be rewritten
  const a = base.slice();
  cur.padSeams(a, w, h, mask, 4);
  let inside = -1;
  for (let i = 0; i < w * h && inside < 0; i++)
    if (mask[i] && (a[i * 4] !== base[i * 4] || a[i * 4 + 1] !== base[i * 4 + 1] || a[i * 4 + 2] !== base[i * 4 + 2] || a[i * 4 + 3] !== base[i * 4 + 3])) inside = i;
  is(inside < 0, "padSeams never writes inside the UV mask" + (inside < 0 ? "" : ` (texel ${inside})`));

  // it must reach exactly maxDist rings and no further — Chebyshev distance, since the frontier
  // grows 4-connected but corners get filled on the following ring
  const dist = new Int32Array(w * h).fill(1e9);
  {
    let q = [];
    for (let i = 0; i < w * h; i++) if (mask[i]) { dist[i] = 0; q.push(i); }
    while (q.length) {
      const nq = [];
      for (const i of q) {
        const x = i % w, y = (i / w) | 0;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
          if (j >= 0 && dist[j] > dist[i] + 1) { dist[j] = dist[i] + 1; nq.push(j); }
      }
      q = nq;
    }
  }
  for (const maxDist of [0, 1, 3, 8]) {
    const b = base.slice();
    cur.padSeams(b, w, h, mask, maxDist);
    // Only the "too far" direction is assertable: a texel inside maxDist can legitimately come out
    // unchanged, because padSeams copies its neighbour's colour and that may already be the value.
    let tooFar = -1;
    for (let i = 0; i < w * h && tooFar < 0; i++) {
      if (mask[i]) continue;
      const changed = b[i * 4] !== base[i * 4] || b[i * 4 + 1] !== base[i * 4 + 1] || b[i * 4 + 2] !== base[i * 4 + 2] || b[i * 4 + 3] !== base[i * 4 + 3];
      if (changed && dist[i] > maxDist) tooFar = i;
    }
    is(tooFar < 0, `padSeams maxDist=${maxDist} writes no texel further than ${maxDist} rings out` + (tooFar < 0 ? "" : ` (texel ${tooFar} at ${dist[tooFar]})`));
    record(`padSeams/32x32/d${maxDist}`, b);
  }
  // maxDist 0 must be a genuine no-op
  const z = base.slice();
  cur.padSeams(z, w, h, mask, 0);
  is(z.every((v, i) => v === base[i]), "padSeams maxDist=0 is a no-op");
  // an all-zero mask has no frontier at all and must not hang or write anything
  const empty = base.slice();
  cur.padSeams(empty, w, h, new Uint8Array(w * h), 4);
  is(empty.every((v, i) => v === base[i]), "padSeams with an empty mask writes nothing");
}

// ---------------------------------------------------------------- optional revision diff
if (REV) {
  console.log(`\n=== byte-for-byte against ${REV} ===`);
  let old;
  try {
    old = load(execSync(`git -C "${ROOT}" show ${REV}:wt_skin_studio.html`, { maxBuffer: 1 << 30, encoding: "utf8" }), REV);
  } catch (e) {
    fail(`could not load ${REV}: ${e.message.split("\n")[0]}`);
  }
  if (old) {
    const same = (label, a, b) => {
      if (a.length !== b.length) return fail(`${label}: length ${a.length} vs ${b.length}`);
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return fail(`${label}: byte ${i} = ${a[i]} vs ${b[i]}`);
      ok(`${label} identical (${a.length} bytes)`);
    };
    for (const [w, h] of [[4, 4], [64, 64], [130, 66], [7, 3]]) {
      const img = testImage(w, h);
      same(`BCnEnc.encodeBC3 ${w}x${h}`, old.encodeBC3(img, w, h), cur.encodeBC3(img.slice(), w, h));
    }
    const img = testImage(64, 64);
    same("BCnEnc.writeDDS DXT5", old.writeDDS(old.buildMips(img, 64, 64, false), { bc3: true }),
      cur.writeDDS(cur.buildMips(img.slice(), 64, 64, false), { bc3: true }));
    same("writeTGA", old.writeTGA(img, 64, 64), cur.writeTGA(img.slice(), 64, 64));
    const n1 = normalImage(32, 32), n2 = n1.slice();
    old.renormalizeWTNormal(n1); cur.renormalizeWTNormal(n2);
    same("BCnEnc.renormalizeWTNormal", n1, n2);
  }
}

// ---------------------------------------------------------------- write / report
if (UPDATE) {
  fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
  fs.writeFileSync(GOLDEN, JSON.stringify(fresh, null, 1) + "\n");
  console.log(`\nwrote ${Object.keys(fresh.cases).length} golden cases to ${path.relative(ROOT, GOLDEN)}`);
} else {
  const stale = Object.keys(golden.cases || {}).filter(k => !(k in fresh.cases));
  if (stale.length) fail(`golden file has ${stale.length} case(s) this run never produced: ${stale.slice(0, 4).join(", ")}`);
}
console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
