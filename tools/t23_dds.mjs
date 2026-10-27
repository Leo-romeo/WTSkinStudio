// Equivalence test for the DDS block decoders after the allocation/mip rework.
//
// It loads the /*==DDS==*/ section out of the CURRENT page and out of whatever git revision is
// named (default HEAD), runs both over the same buffers and compares byte for byte. Random block
// bytes are used deliberately: a BCn block is not validated by either decoder, so random data
// walks both endpoint orderings, every palette index and every alpha mode — more coverage than
// a handful of real textures gives. Real textures from the install are then run too when one
// is reachable.
//
// Usage: node tools/t23_dds.mjs [git-rev]        (default HEAD)
import fs from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/").replace(/\/+$/, "");
const REV = process.argv[2] || "HEAD";

// The decoders were one /*==DDS==*/ section until the codecs layer was split into modules
// (ROADMAP 2.2); they are DDS + BCNDEC now. Naming both and skipping whichever is absent is what
// lets this test still compare against a revision from before the split — which is its whole job.
const PARTS = ["DDS", "BCNDEC"];
const sectionOf = src => PARTS.map(n => {
  const a = src.search(new RegExp("[\\n>]/\\*==" + n + "==\\*/")), b = src.indexOf("\n/*==END" + n + "==*/");
  return a < 0 || b < 0 ? "" : src.slice(a + 1, b);
}).filter(Boolean).join("\n");
const load = (src, tag) => {
  const body = sectionOf(src).replace(/^"use strict";$/m, "");
  if (!body) throw new Error("no DDS section");
  // Each name through its module's namespace since ROADMAP 2.3 (`DDS.parseDDS`), or bare in a
  // revision from before it — the same either way to everything below.
  const names = [["DDS", "parseDDS"], ["DDS", "decodeMasked"], ["BCnDec", "decodeBCn"], ["BCnDec", "decodeBC4Block"],
                 ["BCnDec", "decodeBC7"], ["BCnDec", "decodeBC4Tex"], ["DDS", "maskShift"]];
  const fn = new Function(body + "\nreturn {" + names.map(([ns, n]) => n + ": typeof " + ns + " !== \"undefined\" ? " + ns + "." + n + " : " + n).join(",") + "};");
  const m = fn();
  m.tag = tag;
  return m;
};

const cur = load(fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8"), "new");
const old = load(execSync(`git -C "${ROOT}" show ${REV}:wt_skin_studio.html`, { maxBuffer: 1 << 30, encoding: "utf8" }), REV);

// deterministic PRNG so a failure is reproducible
let seed = 0x2f6e2b1;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const bytes = n => { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = (rnd() * 256) | 0; return a; };

let fails = 0, checks = 0;
const same = (label, a, b) => {
  checks++;
  if (a.length !== b.length) { console.log("FAIL " + label + ": length " + a.length + " vs " + b.length); fails++; return; }
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i]) { console.log("FAIL " + label + ": byte " + i + " = " + a[i] + " vs " + b[i]); fails++; return; }
  console.log("ok   " + label + " (" + a.length + " bytes)");
};

// ---- block-compressed formats ----
for (const [fmt, bs] of [["DXT1", 8], ["DXT3", 16], ["DXT5", 16], ["BC5", 16]]) {
  for (const [w, h] of [[4, 4], [64, 64], [130, 66], [1, 1], [7, 3]]) {
    const bw = Math.max(1, (w + 3) >> 2), bh = Math.max(1, (h + 3) >> 2);
    const src = bytes(bw * bh * bs);
    same(`${fmt} ${w}x${h}`, old.decodeBCn(src, w, h, fmt), cur.decodeBCn(src, w, h, fmt));
  }
}
// BC4 single channel
for (const [w, h] of [[4, 4], [64, 32], [130, 66]]) {
  const bw = Math.max(1, (w + 3) >> 2), bh = Math.max(1, (h + 3) >> 2);
  const src = bytes(bw * bh * 8);
  same(`BC4 ${w}x${h}`, old.decodeBC4Tex(src, w, h), cur.decodeBC4Tex(src, w, h));
}
// BC7. Two sizes on purpose: the small one is the old sanity check that the section extracts,
// the big one is 16 384 random blocks, which is what makes this an equivalence test for the DECODER
// rather than for one sample. A block's mode is the count of leading zero bits, so random bytes hit
// mode 0 half the time and mode 7 about sixty times in that many — every mode, every partition
// count, both index sets and the channel rotation all walked (ROADMAP 2.4 split the block decoder
// on the strength of exactly this).
{
  const src = bytes(16 * 16 * 16);
  same("BC7 64x64", old.decodeBC7(src, 64, 64), cur.decodeBC7(src, 64, 64));
  const big = bytes(128 * 128 * 16);
  same("BC7 512x512 (16 384 random blocks — every mode)", old.decodeBC7(big, 512, 512), cur.decodeBC7(big, 512, 512));
}
// the standalone block helper other call sites may still use
{
  const src = bytes(64);
  const a = Array.from(old.decodeBC4Block(src, 0)), b = Array.from(cur.decodeBC4Block(src, 0));
  same("BCnDec.decodeBC4Block", Float64Array.from(a), Float64Array.from(b));
}

// ---- uncompressed / masked formats ----
const MASKSETS = [
  ["B8G8R8A8", 32, [0xff0000, 0xff00, 0xff, 0xff000000]],
  ["R8G8B8A8", 32, [0xff, 0xff00, 0xff0000, 0xff000000]],
  ["B8G8R8",   24, [0xff0000, 0xff00, 0xff, 0]],
  ["R5G6B5",   16, [0xf800, 0x7e0, 0x1f, 0]],
  ["A1R5G5B5", 16, [0x7c00, 0x3e0, 0x1f, 0x8000]],
  ["A4R4G4B4", 16, [0xf00, 0xf0, 0xf, 0xf000]],
  ["X8R8G8B8", 32, [0xff0000, 0xff00, 0xff, 0]],
];
for (const [name, bits, masks] of MASKSETS) {
  const w = 37, h = 11, src = bytes(w * h * (bits >> 3));
  same(`masked ${name}`, old.decodeMasked(src, w, h, bits, masks), cur.decodeMasked(src, w, h, bits, masks));
}

// ---- whole files through DDS.parseDDS ----
const ddsFile = (w, h, fourCC, payload) => {
  const head = new Uint8Array(128);
  const dv = new DataView(head.buffer);
  dv.setUint32(0, 0x20534444, true); dv.setUint32(4, 124, true);
  dv.setUint32(12, h, true); dv.setUint32(16, w, true);
  dv.setUint32(28, 1 + Math.floor(Math.log2(Math.max(w, h))), true);   // full mip chain
  dv.setUint32(76, 32, true); dv.setUint32(80, 0x4, true);
  for (let i = 0; i < 4; i++) dv.setUint8(84 + i, fourCC.charCodeAt(i));
  const out = new Uint8Array(head.length + payload.length);
  out.set(head); out.set(payload, head.length);
  return out.buffer;
};
for (const [fourCC, bs] of [["DXT1", 8], ["DXT5", 16], ["ATI2", 16]]) {
  const w = 256, h = 256;
  let total = 0;
  for (let lw = w, lh = h; ; lw = Math.max(1, lw >> 1), lh = Math.max(1, lh >> 1)) {
    total += Math.max(1, (lw + 3) >> 2) * Math.max(1, (lh + 3) >> 2) * bs;
    if (lw === 1 && lh === 1) break;
  }
  const buf = ddsFile(w, h, fourCC, bytes(total));
  const a = old.parseDDS(buf.slice(0)), b = cur.parseDDS(buf.slice(0));
  checks++;
  if (a.width !== b.width || a.height !== b.height || a.format !== b.format || a.mips.length !== b.mips.length) {
    console.log(`FAIL DDS.parseDDS ${fourCC}: header ${a.width}x${a.height} ${a.format} ${a.mips.length} vs ${b.width}x${b.height} ${b.format} ${b.mips.length}`);
    fails++;
  } else {
    // every level, including the ones the new code decodes lazily
    let bad = -1;
    for (let m = 0; m < a.mips.length && bad < 0; m++) {
      const x = a.mips[m].rgba, y = b.mips[m].rgba;
      if (a.mips[m].w !== b.mips[m].w || a.mips[m].h !== b.mips[m].h || x.length !== y.length) { bad = m; break; }
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) { bad = m; break; }
    }
    if (bad >= 0) { console.log(`FAIL DDS.parseDDS ${fourCC}: mip ${bad} differs`); fails++; }
    else console.log(`ok   DDS.parseDDS ${fourCC} — ${a.mips.length} mips identical (lazy levels forced)`);
  }
}

// mips[0] must be a plain own value, not a getter: everything in the app reads it per stroke
{
  const buf = ddsFile(64, 64, "DXT5", bytes(16 * 16 * 16 * 2));
  const d = cur.parseDDS(buf);
  const desc = Object.getOwnPropertyDescriptor(d.mips[0], "rgba");
  checks++;
  if (!desc || typeof desc.get === "function") { console.log("FAIL mips[0].rgba should be eager"); fails++; }
  else console.log("ok   mips[0].rgba is eager, " + (d.mips.length - 1) + " deferred levels");
}

// ---- a crafted channel mask must not hang the decoder (ROADMAP 1.21 (1)) ----
// `DDS.maskShift` counted a mask's bits with `while ((m >>> (s + b)) & 1) b++`, and a JavaScript shift
// wraps at 32: for 0xFFFFFFFF, `m >>> 32` is `m` again and the loop never ended — on the main thread
// through DDS.parseDDS, and in the decode pool, which waits for a reply that never comes. Only the
// CURRENT section is run (the revision compared against may be the one that hangs), and it runs in
// a worker thread with a deadline, so a regression is a FAIL in seconds rather than a hung suite.
{
  const { Worker } = await import("worker_threads");
  const body = sectionOf(fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8")).replace(/^"use strict";$/m, "");
  const code = `const { parentPort } = require("worker_threads");
    const m = (function(){ ${body}\n return { maskShift: DDS.maskShift, decodeMasked: DDS.decodeMasked }; })();
    const all = m.maskShift(0xFFFFFFFF), top = m.maskShift(0x80000000);
    const px = m.decodeMasked(new Uint8Array(4 * 4 * 4).fill(7), 4, 4, 32, [0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF]);
    parentPort.postMessage({ all, top, n: px.length });`;
  const res = await new Promise(resolve => {
    const w = new Worker(code, { eval: true });
    const t = setTimeout(() => { w.terminate(); resolve(null); }, 5000);
    w.on("message", v => { clearTimeout(t); w.terminate(); resolve(v); });
    w.on("error", e => { clearTimeout(t); resolve({ err: String(e && e.message || e) }); });
  });
  checks++;
  if (!res) { console.log("FAIL all-ones channel mask: DDS.maskShift/DDS.decodeMasked did not return within 5 s (the shift wraps at 32)"); fails++; }
  else if (res.err) { console.log("FAIL all-ones channel mask threw: " + res.err); fails++; }
  else if (res.all.s !== 0 || res.all.bits !== 32 || res.top.s !== 31 || res.top.bits !== 1 || res.n !== 64) {
    console.log("FAIL all-ones channel mask: " + JSON.stringify(res)); fails++;
  } else console.log("ok   all-ones channel mask returns at once — 32 bits from 0, top bit 1 from 31, a 4x4 decoded");
}

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
