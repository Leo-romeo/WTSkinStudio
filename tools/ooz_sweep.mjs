// Compare the shipped build's Oodle decoder against RAD's on the real install, using the app's own
// .dxp.bin parser. Written for ooz (ROADMAP 5.1, docs/OODLE.md) and still named for it; since
// 2026-09-14 the default build carries the project's own decoder (docs/WTLZ.md), so that is what
// this measures now, and the variable names below that say `ooz` mean "the decoder under test".
//
// This is the measurement behind ROADMAP 5.1, moved out of a scratchpad and given the same shape
// as the rest of tools/: it runs the page's PACKS + DXP sections under Node (CLAUDE.md §6 — get
// the answer from the data, and from the code that ships, not a paraphrase of it), so a change to
// how the app reads a pack changes what this measures too.
//
//   node tools/ooz_sweep.mjs [--per-tier 250] [--seed 1]
//   node tools/t46_wtlz.mjs --install       (the same sweep, as assertions)
//
// It needs RAD's blob, so it is the owner's check and never a gate: src/vendor/oodle-b64.js is not
// in a public checkout, and the whole point of the exercise is that it does not have to be.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { build } from "./build.mjs";
import { installDir, installOrExit, isDirEntry } from "./wtdir.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// No install is resolved at import: t46 imports this module under --install only, and a module that
// looked for the game on load would make every importer pay for it. installDir() throws, naming the
// path and what is missing, when a sweep is actually asked for and there is no install.

function section(src, name) {
  const a = src.search(new RegExp("[\\n>]/\\*==" + name + "==\\*/"));
  const b = src.indexOf("\n/*==END" + name + "==*/");
  if (a < 0 || b < 0) throw new Error("section " + name + " not found");
  return src.slice(a + 1, b);
}

// A File the way indexDxp expects one, over an fd. Reads are slices, so nothing loads a 2 GB pack.
function fileOver(p) {
  const size = fs.statSync(p).size;
  return {
    size,
    slice(a, b) {
      return { async arrayBuffer() {
        const n = Math.max(0, Math.min(b, size) - a);
        const buf = Buffer.alloc(n);
        const fd = fs.openSync(p, "r");
        try { fs.readSync(fd, buf, 0, n, a); } finally { fs.closeSync(fd); }
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + n);
      } };
    },
  };
}

function walk(dir, re, out = []) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (isDirEntry(e, p)) walk(p, re, out);
    else if (re.test(e.name)) out.push(p);
  }
  return out;
}

// Lift the parser out of the built page and index every texture pack in the install.
export async function indexInstall(wt = installDir()) {
  const html = fs.readFileSync(path.join(ROOT, "wt_skin_studio.html"), "utf8");
  // GameDB and KNOWN_FMTS sit just outside the PACKS markers, so every offline tool that lifts
  // PACKS declares them itself — same prelude as tools/t21_cache.mjs.
  const prelude = `
    const GameDB = { entries: [], stems: new Map(), packs: 0, unknown: new Map(),
      desc: null, descDbs: [], models: [], packList: [], descBindCache: new Map() };
    const KNOWN_FMTS = ["DXT1", "DXT3", "DXT5", "ATI1", "ATI2", "BC5U", "BC7"];
    const Oodle = { oodleAvailable: () => true };   // index everything; the byte comparison is the verdict
  `;
  const P = new Function(prelude + section(html, "PACKS") + "\n" + section(html, "DXP") + "\n" +
    "return { GameDB, indexDxp };")();
  const packs = walk(wt, /\.dxp\.bin$/i);
  for (const p of packs) {
    const handle = { getFile: async () => fileOver(p) };
    try { await P.indexDxp(handle, p); } catch { /* not a readable pack; the app skips these too */ }
  }
  return { db: P.GameDB, packs: packs.length };
}

// The DDSx header carries the sizes; en.header is the 32 bytes indexDxp kept.
function entrySizes(en) {
  const hd = new DataView(en.header.buffer, en.header.byteOffset, en.header.byteLength);
  return { memSz: hd.getUint32(0x18, true), packedSz: hd.getUint32(0x1c, true) };
}

// en.pack is an index into GameDB.packList (that indirection is what lets the index be cached
// across sessions), so the pack's path comes from the db, not from the entry.
function bytesOf(db, en) {
  const p = db.packList[en.pack].path;
  const buf = Buffer.alloc(en.size);
  const fd = fs.openSync(p, "r");
  try { fs.readSync(fd, buf, 0, en.size, en.off); } finally { fs.closeSync(fd); }
  return new Uint8Array(buf);
}

// `ooz` and `rad` are { ensureOodle, oodleDecompress } lifted from a built page; rad may be null.
export async function sweep(ooz, rad, opts = {}) {
  const perTier = opts.perTier || 250;
  const { db, packs } = await indexInstall(opts.wt);
  const oozEx = await ooz.ensureOodle();
  const radEx = rad ? await rad.ensureOodle() : null;

  const byTier = { uhq: [], hq: [], base: [], tq: [] };
  for (const en of db.entries) if (en.compName === "oodle" && en.size && byTier[en.tier]) byTier[en.tier].push(en);

  // Deterministic sampling: every Nth entry, not a random draw, so two runs are comparable.
  const out = { packs, oodleEntries: 0, compared: 0, identical: 0, differing: 0, oozFailed: 0, radFailed: 0, tiers: {} };
  for (const tier of Object.keys(byTier)) {
    const list = byTier[tier];
    out.oodleEntries += list.length;
    const step = Math.max(1, Math.floor(list.length / perTier));
    let n = 0, same = 0, diff = 0, oozBad = 0, radBad = 0;
    for (let i = 0; i < list.length && n < perTier; i += step) {
      const en = list[i];
      const { memSz } = entrySizes(en);
      if (!memSz) continue;
      const src = bytesOf(db, en);
      let a = null, b = null;
      try { a = ooz.oodleDecompress(oozEx, src, memSz); } catch { oozBad++; }
      if (radEx) { try { b = rad.oodleDecompress(radEx, src, memSz); } catch { radBad++; } }
      n++;
      if (a && b) { if (Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0) same++; else diff++; }
      else if (a && !radEx) same++;
    }
    out.tiers[tier] = { available: list.length, compared: n, identical: same, differing: diff, oozFailed: oozBad, radFailed: radBad };
    out.compared += n; out.identical += same; out.differing += diff; out.oozFailed += oozBad; out.radFailed += radBad;
  }
  return out;
}

// ---- geometry ---------------------------------------------------------------------------------
// Textures are only half of "every plane and tank loads": a DynModel's MatVData is a GRP
// CompressedData block with its own method byte (0x80 = Oodle), and 113 of 120 sampled models
// failed to load without a decoder. Rather than re-deriving where inside a .grp entry that block
// starts — the byte-scanning heuristic that did that is what produced the single crash in the
// previous sweep — this hands the app's own loader a RECORDING decompressor and compares what it
// actually asked for. No format knowledge here at all, and it covers exactly the calls the app makes.
export async function sweepGeometry(ooz, rad, opts = {}) {
  const sample = opts.sample || 120;
  const html = fs.readFileSync(path.join(ROOT, "wt_skin_studio.html"), "utf8");
  // `refused` is kept apart from `seen` on purpose. `loadDynModelBytes` throws for several reasons
  // that have nothing to do with the decoder — 632 of the install's 25 789 DynModels fail to parse
  // with RAD's decoder too — so counting every throw as a decoder failure would report a permanent
  // 2 % failure rate and hide a real regression inside it.
  const make = oodle => {
    const seen = [], refused = [];
    // MODEL reaches the decoders through the codecs' namespaces (ROADMAP 2.3), so those are what
    // stand in here: `Oodle` with the two calls the app makes, `Zstd` refusing.
    const M = new Function("Oodle", "Zstd",
      section(html, "MODEL") + "\nreturn { grpParseFront, GRP_CLS, loadDynModelBytes };")(
      { ensureOodle: async () => (oodle ? oodle.ensureOodle() : null),
        oodleDecompress: (ex, data, raw) => {
          let out;
          try { out = oodle.oodleDecompress(ex, data, raw); }
          catch (e) { refused.push(e.message); throw e; }
          seen.push(out);
          return out;
        } },
      { zstdDec: () => { throw new Error("a zstd model turned up where the Oodle comparison runs"); } });
    return { M, seen, refused };
  };
  const A = make(ooz), B = rad ? make(rad) : null;

  const models = [];
  for (const p of walk(opts.wt || installDir(), /\.grp$/i)) {
    let front;
    try { front = A.M.grpParseFront(new Uint8Array(fs.readFileSync(p))); } catch { continue; }
    for (const e of front.entries) if (e.classId === A.M.GRP_CLS.DynModel) models.push({ p, e });
  }
  const step = Math.max(1, Math.floor(models.length / sample));
  const out = { models: models.length, loaded: 0, refused: 0, unparsed: 0, blocks: 0, identical: 0,
                differing: 0, refusedNames: [] };
  for (let i = 0; i < models.length && out.loaded + out.refused + out.unparsed < sample; i += step) {
    const { p, e } = models[i];
    const u8 = new Uint8Array(fs.readFileSync(p)).subarray(e.offset, e.offset + e.size);
    A.seen.length = 0; A.refused.length = 0; if (B) { B.seen.length = 0; B.refused.length = 0; }
    try {
      await A.M.loadDynModelBytes(u8, e.name);
      if (B) await B.M.loadDynModelBytes(u8, e.name);
      out.loaded++;
    } catch {
      // The decoder is only implicated if it is what said no. Everything else is the model reader
      // meeting something it does not handle, and RAD's decoder meets it too.
      if (A.refused.length) { out.refused++; out.refusedNames.push(e.name); } else out.unparsed++;
      continue;
    }
    for (let k = 0; k < A.seen.length; k++) {
      out.blocks++;
      if (!B) { out.identical++; continue; }
      Buffer.compare(Buffer.from(A.seen[k]), Buffer.from(B.seen[k] || [])) === 0 ? out.identical++ : out.differing++;
    }
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  installOrExit();   // before building anything: no install is one line and exit 1
  const argv = process.argv.slice(2);
  const perTier = argv.includes("--per-tier") ? +argv[argv.indexOf("--per-tier") + 1] : 250;
  // The decoder under test is whatever the default build carries — since 2026-09-14 the
  // project's own, a section of the page rather than a blob, lifted here the way the decode pool
  // lifts it. RAD is the reference and is optional (its blob is git-ignored).
  function oodleFrom(html) {
    const blob = /const OODLE_WASM_B64 = "([^"]*)";/.exec(html);
    const impl = /const OODLE_IMPL = "([^"]*)";/.exec(html);
    if (!impl || !impl[1]) throw new Error("no Oodle decoder in this build");
    const a = html.search(/[\n>]\/\*==WTLZ==\*\//), b = html.indexOf("\n/*==ENDWTLZ==*/");
    const wtlz = a >= 0 && b >= 0 ? html.slice(a + 1, b) : "";
    return new Function("var OODLE_IMPL = " + JSON.stringify(impl[1]) + ";\n" +
      "var OODLE_WASM_B64 = " + JSON.stringify(blob ? blob[1] : "") + ";\n" +
      wtlz + "\n" + section(html, "OODLE") + "\nreturn { ensureOodle: Oodle.ensureOodle, oodleDecompress: Oodle.oodleDecompress };")();
  }
  const pub = build().html;
  let rad = null;
  try { rad = oodleFrom(build(ROOT, { rad: true }).html); } catch { console.log("(no RAD blob — reporting the decoder's own success rate only)"); }
  const r = await sweep(oodleFrom(pub), rad, { perTier });
  console.log(`${r.packs} packs · ${r.oodleEntries.toLocaleString()} Oodle entries`);
  for (const [tier, t] of Object.entries(r.tiers)) {
    console.log(`  $${tier.padEnd(5)} ${String(t.compared).padStart(4)} compared of ${String(t.available).padStart(7)}` +
      `   identical ${t.identical}   differing ${t.differing}   ooz failed ${t.oozFailed}` + (t.radFailed ? `   RAD failed ${t.radFailed}` : ""));
  }
  console.log(`\n${r.identical}/${r.compared} byte-identical, ${r.differing} differing, ${r.oozFailed} refused by ooz`);

  const g = await sweepGeometry(oodleFrom(pub), rad, { sample: argv.includes("--models") ? +argv[argv.indexOf("--models") + 1] : 120 });
  console.log(`\ngeometry: ${g.loaded} DynModels loaded of ${g.models.toLocaleString()} in the install`);
  console.log(`  ${g.refused} refused by the decoder` + (g.refused ? ": " + g.refusedNames.slice(0, 20).join(", ") : ""));
  console.log(`  ${g.unparsed} the model reader could not parse at all — not a decoder problem, RAD hits these too`);
  console.log(`  ${g.identical}/${g.blocks} decompressed blocks byte-identical, ${g.differing} differing`);
  process.exit(r.differing === 0 && r.oozFailed === 0 && g.differing === 0 && g.refused === 0 ? 0 : 1);
}
