// The build has a real Oodle decoder, and it is ours to ship (ROADMAP 5.1, 5.4).
//
// Since 2026-09-14 the decoder `node tools/build.mjs` puts in the page is the project's own,
// `src/codecs/wtlz.js` — plain JavaScript, exported from the wt-codec-cleanroom repository, where
// every format fact has a numbered log entry holding the experiment that established it
// (docs/WTLZ.md). It replaced ooz (GPL-3), which had replaced RAD's EULA-encumbered blob on
// 2026-08-25; both survive as diagnostic builds (`--ooz`, `--rad`) and neither may be in the
// artifact this test reads. Four things have to hold and none of them is visible from reading the
// code: the shipped page has to carry **exactly one decoder and it has to be ours** — no ooz
// bytes, no RAD bytes — the decoder has to read a real Leviathan stream **byte-for-byte
// identically to RAD**, it has to survive the trailing input that War Thunder's own containers
// hand it, and the copy in this repo has to be the export it says it is, not a hand edit.
//
// **The RAD half of this test is optional, and that is the point.** src/vendor/oodle-b64.js is
// git-ignored, so a clone does not have it and `--rad` cannot be built there. The proof that the
// decoder matches RAD does not depend on RAD being present: it is a stored golden of RAD's own
// output (GOLD_SHA below), taken when both were on the same machine. So the checks that need the
// blob are skipped when it is absent and the correctness proof still runs — which is exactly what
// has to be true for this repo to be publishable at all.
//
// The fixture is `tools/fixtures/leviathan.block0`: the first 86 233 bytes of ooz's own
// `testdata/dickens.leviathan`, which is the Silesia corpus's Dickens text (Project Gutenberg,
// public domain) compressed with RAD's Leviathan. That is exactly one 256 KB block, so the test is
// self-contained, needs no War Thunder install, and — this matters — carries no game asset. It is
// data, not code: a stream the clean-room decoder never saw while it was being written, from the
// format's own encoder outside the game, which is what makes it worth keeping. 262 144 bytes is
// also precisely a 512×512 DXT5 surface, which is what lets the last section feed it through the
// app's real `gameTexture` worker op as a texture rather than a synthetic buffer.
//
// Usage: node tools/t46_wtlz.mjs [--keep] [--chrome <path>] [--install]
//        --install additionally sweeps the live game install, comparing the shipped decoder
//                  against RAD on real textures and real model geometry. Needs the RAD blob, so it
//                  is the owner's check, not a gate. `node tools/ooz_sweep.mjs` is the same thing
//                  as a report. The population proof lives in the clean-room repository
//                  (141 898 / 141 898 payloads and 24 622 / 24 622 model streams, docs/WTLZ.md).
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync, spawn } from "child_process";
import { fileURLToPath } from "url";
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";
import { build } from "./build.mjs";
import { section, oodleFrom } from "./oodle_lift.mjs";
import { installOrExit } from "./wtdir.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
// --install sweeps the game: without one that is one line and exit 1 now, not after the browser half.
if (argv.includes("--install")) installOrExit();
const R = makeReport();
const J = v => JSON.stringify(v);

const FIXTURE = fs.readFileSync(path.join(ROOT, "tools", "fixtures", "leviathan.block0"));
const RAW = 262144;
// What RAD's own decoder produces from that fixture, captured 2026-08-22. If this hash ever moves,
// the decoder changed — that is the point of writing it down rather than comparing a decoder to
// itself.
const GOLD_SHA = "becc366f2948cfbaefb219df19f54b101a842737428b01c7538b871a35c3edf4";
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
// A checksum both Node and the page can compute with nothing imported, so the browser half can be
// compared against the same golden without SubtleCrypto (whose availability on file:// is not
// something this suite should depend on).
const FNV = "function fnv(u8){var h=0x811c9dc5;for(var i=0;i<u8.length;i++){h^=u8[i];h=Math.imul(h,16777619)>>>0;}return h>>>0;}";
const fnv = new Function(FNV + "return fnv;")();

// ---------------------------------------------------------------- the bytes
console.log("=== the build carries the project's own decoder, and no one else's ===");
const pub = build().html;                       // the default build, and the only one that ships
const radPath = path.join(ROOT, "src", "vendor", "oodle-b64.js");
const hasRad = fs.existsSync(radPath);
const blobNeedle = src => /const OODLE_WASM_B64 = "([A-Za-z0-9+/]{64})/.exec(src);
// ooz's blob is kept out of the public repository, so its needle is stored: the
// first 64 base64 characters of src/vendor/ooz-b64.js, held to that file wherever it exists.
const OOZ_NEEDLE = "AGFzbQEAAAABpAESYAJ/fwF/YAN/f38Bf2AEf39/fwF/YAV/f39/fwF/YAt/f39/";
const oozPath = path.join(ROOT, "src", "vendor", "ooz-b64.js");
const hasOoz = fs.existsSync(oozPath);
R.is(/const OODLE_IMPL = "wtlz";/.test(pub), 'the slot names the decoder: OODLE_IMPL is "wtlz"');
R.is(/[\n>]\/\*==WTLZ==\*\//.test(pub) && pub.includes("\n/*==ENDWTLZ==*/"), "and the WTLZ section is in the page for the worker to lift");
R.is(/const OODLE_WASM_B64 = "";/.test(pub), "there is no WASM Oodle blob in the build — the slot declares it empty");
if (hasOoz) R.is(blobNeedle(fs.readFileSync(oozPath, "utf8"))?.[1] === OOZ_NEEDLE, "the stored ooz needle is still how src/vendor/ooz-b64.js begins, so the exclusion below means something");
R.is(!pub.includes(OOZ_NEEDLE), "ooz's bytes are NOT in the build — nothing GPL-3 is linked into the page that ships (docs/LICENSING.md)");
R.is(!pub.includes("UnrealEngine") && !pub.includes("Unreal Engine EULA"),
  "no Unreal Engine EULA notice survives into the artifact — nothing encumbered came along with it");
// The two diagnostics still build, each carries exactly one decoder, and it is never ours.
if (hasOoz) {
  const ooz = build(ROOT, { ooz: true }).html;
  R.is(ooz.includes(OOZ_NEEDLE), "--ooz still produces the diagnostic build that has ooz's bytes");
  R.is(!/[\n>]\/\*==WTLZ==\*\//.test(ooz) && /const OODLE_IMPL = "ooz";/.test(ooz), "and that build carries no WTLZ section — one decoder per page, so an A/B compares decoders");
} else {
  console.log("  ---- src/vendor/ooz-b64.js is absent (not in the public repository), so the two --ooz checks");
  console.log("       are skipped. The page is still searched for ooz's bytes, by the stored needle.");
}
if (hasRad) {
  const radNeedle = blobNeedle(fs.readFileSync(radPath, "utf8"));
  const rad = build(ROOT, { rad: true }).html;
  R.is(!!radNeedle, "RAD's blob was located too, so the exclusion below means something");
  R.is(radNeedle && !pub.includes(radNeedle[1]), "RAD's bytes are NOT in the build (CLAUDE.md §0.2)");
  R.is(radNeedle && rad.includes(radNeedle[1]), "--rad still produces the diagnostic build that has them");
  R.is(!/[\n>]\/\*==WTLZ==\*\//.test(rad) && !rad.includes(OOZ_NEEDLE), "and that build carries neither WTLZ nor ooz");
  R.is(pub.length < rad.length, `the shipped artifact is smaller than the RAD one — ${Math.round((rad.length - pub.length) / 1024)} KB less`);
} else {
  console.log("  ---- src/vendor/oodle-b64.js is absent (git-ignored, as on a clone), so the five");
  console.log("       RAD-comparison checks are skipped. The golden below still proves the decoder matches it.");
}

// ------------------------------------------------ the copy in this repo is the export it claims
// codecs/wtlz.js is generated by the clean-room repository's tools/export.mjs, and its header
// names the commit and the SHA-256 of the source it was made from. A hand edit here would be a
// format claim with no experiment behind it; what can be checked without that repository present
// is that the file still has the shape of an export — the provenance header, the one-name wrapper
// and nothing outside it. `node tools/export.mjs --check` over there is the byte-exact check.
console.log("\n=== the decoder in src/ is an export, not an edit ===");
const wtlzSrc = fs.readFileSync(path.join(ROOT, "src", "codecs", "wtlz.js"), "utf8");
const srcLine = /^\/\/   source   wt-codec-cleanroom  src\/decoder\.mjs  @ ([0-9a-f]{40})$/m.exec(wtlzSrc);
const shaLine = /^\/\/   sha256   ([0-9a-f]{64})  \(of that file, LF line endings\)$/m.exec(wtlzSrc);
R.is(!!srcLine, `the header names the source commit → ${srcLine ? srcLine[1].slice(0, 12) : "(missing)"}`);
R.is(!!shaLine, `and the SHA-256 of the source file → ${shaLine ? shaLine[1].slice(0, 12) + "…" : "(missing)"}`);
R.is(wtlzSrc.startsWith("/*==WTLZ==*/\n") && wtlzSrc.trimEnd().endsWith("/*==ENDWTLZ==*/"), "the file is one marked section, first byte to last");
R.is(/\nconst WTLZ = \(function\(\)\{\n"use strict";\n/.test(wtlzSrc) && /\n  return \{ decompress \};\n\}\)\(\);\n\/\*==ENDWTLZ==\*\/\n?$/.test(wtlzSrc),
  "wrapped in one function that returns { decompress } — the page sees one name, WTLZ");
R.is(!/^\s*(export|import)\b/m.test(wtlzSrc), "no `export` or `import` survived the export — it is a classic script");
R.is((wtlzSrc.match(/EVIDENCE: LOG\/\d+/g) || []).length > 150, `and it carries its evidence tags → ${(wtlzSrc.match(/EVIDENCE: LOG\/\d+/g) || []).length} of them`);

// ------------------------------------------------- the page's own decoder, under Node
// Lifted by marker, the way every offline test lifts app code (CLAUDE.md §2). This is the same
// text the page runs and the same text the decode worker runs. WTLZ is lifted when the build has
// it — the same rule the decode pool's section list follows.
// `section` and `oodleFrom` live in tools/oodle_lift.mjs since 2026-09-20, shared with every roster
// tool — eight of them carried their own lift, three of them RAD-only and broken since this build.

// ---------------------------------------------------- and RAD is not anywhere in the repository
//
// WHY THIS IS A TEST AND NOT A CHECKLIST. On 2026-08-25 the repository's history was purged of the
// RAD blob, and the first attempt looked like it had worked: `git log --all -- src/vendor/oodle-b64.js`
// printed nothing and `git rev-list --objects --all | grep oodle-b64` found only the stub. Both were
// searching for a **file name**. The blob was still in 22 objects — every historical version of the
// committed `wt_skin_studio.html`, which was built with RAD until that day and therefore had it
// **inlined as base64**, under a completely different name and inside a file nobody would think
// to grep.
//
// So the only check worth running is for the bytes, and it belongs in the suite rather than in a
// release checklist, because a checklist is consulted once and a test runs every time. Committing a
// RAD-built artifact — the exact accident §0.2 is about — now fails `npm test` on the spot.
//
// Only blobs over 100 KB are opened: RAD's is 250 KB of base64, so nothing smaller can contain it,
// and that keeps this constant-time as history grows. (ooz's bytes ARE in history — the artifact
// was built with it from 2026-08-25 to 2026-09-14 — and that is fine: ooz is GPL-3 with its
// sources in vendor/ooz/, and what the licence question turns on is the page that ships, which the
// first section above checks.)
if (fs.existsSync(path.join(ROOT, ".git")) && hasRad) {
  console.log("\n=== and the RAD bytes are in no object in this repository ===");
  const radSrc = fs.readFileSync(radPath, "utf8");
  const needle = /const OODLE_WASM_B64 = "([A-Za-z0-9+/]{96})/.exec(radSrc);
  const run = (cmd, opts) => execSync(cmd, { cwd: ROOT, maxBuffer: 1 << 28, ...opts });
  // ROADMAP 0.4: this scan was 49 of the suite's 307 s (2026-10-22), because it started one `git
  // cat-file blob` process per object. Two things fixed it. (1) One `git cat-file --batch` stream
  // reads every object in one process. (2) Objects are immutable — an id that was clean against a
  // needle stays clean against it — so the ids found clean are kept in a git-ignored record keyed by
  // the needle and by SCAN_VERSION, and a later run opens only objects it has not seen. Every object
  // is still scanned against every needle set once (CLAUDE.md §0.2); a new needle, or a bump of
  // SCAN_VERSION when the scan itself changes, starts the record over. A carrier is never recorded.
  const SCAN_VERSION = 1;
  const recPath = path.join(ROOT, "dist", "t46-clean.json");
  const key = needle ? sha(SCAN_VERSION + ":" + needle[1]) : "";
  let rec = { key, clean: [] };
  try { const r = JSON.parse(fs.readFileSync(recPath, "utf8")); if (r.key === key && Array.isArray(r.clean)) rec = r; }
  catch { /* no record yet, or an unreadable one: the answer is a full scan */ }
  const known = new Set(rec.clean);
  let scanned = 0, skipped = 0;
  const carriers = [];
  if (needle) {
    const todo = [];
    for (const line of run("git cat-file --batch-all-objects --batch-check", { encoding: "utf8" }).split("\n")) {
      const [id, type, size] = line.trim().split(/\s+/);
      if (type !== "blob" || +size < 100000) continue;
      if (known.has(id)) { skipped++; continue; }
      todo.push(id);
    }
    if (todo.length) {
      // Streamed, one object in memory at a time: the blobs over 100 KB were 1.19 GB on 2026-10-22,
      // and read into one buffer that is most of the way to Node's limit and grows with every commit.
      const want = Buffer.from(needle[1], "latin1");
      await new Promise((resolve, reject) => {
        const git = spawn("git", ["cat-file", "--batch"], { cwd: ROOT, stdio: ["pipe", "pipe", "inherit"] });
        // --batch writes "<id> <type> <size>\n<bytes>\n" per object, in the order asked.
        // Chunks are gathered in a list and joined once per object: joining on every chunk copied a
        // 5 MB artifact ~80 times and cost a third of the scan.
        let parts = [], have = 0, cur = null;
        git.stdout.on("data", chunk => {
          parts.push(chunk); have += chunk.length;
          for (;;) {
            if (!cur) {
              const head = parts.length > 1 ? Buffer.concat(parts) : parts[0];
              const nl = head ? head.indexOf(10) : -1;
              if (nl < 0) return;
              const [id, , size] = head.toString("latin1", 0, nl).split(" ");
              cur = { id, size: +size };
              const rest = head.subarray(nl + 1);
              parts = rest.length ? [rest] : []; have = rest.length;
            }
            if (have < cur.size + 1) return;
            const all = parts.length > 1 ? Buffer.concat(parts) : parts[0];
            scanned++;
            if (all.subarray(0, cur.size).includes(want)) carriers.push(cur.id.slice(0, 10));
            else known.add(cur.id);
            const rest = all.subarray(cur.size + 1);
            parts = rest.length ? [rest] : []; have = rest.length;
            cur = null;
          }
        });
        git.on("error", reject);
        git.on("close", code => code === 0 ? resolve() : reject(new Error("git cat-file --batch exited " + code)));
        git.stdin.end(todo.join("\n") + "\n");
      });
      R.is(scanned === todo.length, `the batch stream answered every object asked for → ${scanned} of ${todo.length}`);
      try { fs.mkdirSync(path.dirname(recPath), { recursive: true }); fs.writeFileSync(recPath, JSON.stringify({ key, clean: [...known] })); }
      catch (e) { console.log(`  (could not keep the clean-id record at ${recPath}: ${e.message} — the next run scans everything again)`); }
    }
  }
  R.is(!!needle, "the RAD needle was built, so the scan below means something");
  R.is(carriers.length === 0, carriers.length
    ? `${carriers.length} git objects carry the RAD blob: ${carriers.join(", ")} — history needs purging (docs/LICENSING.md)`
    : `no git object carries the RAD blob (${scanned} blobs over 100 KB opened and searched, ${skipped} already found clean against this needle)`);
} else if (!hasRad) {
  console.log("\n  ---- the repository scan needs RAD's bytes to search for, and the blob is absent.");
  console.log("       On a clone that is the expected state: there is nothing to have leaked.");
}

console.log("\n=== the decoder reads real Leviathan, and agrees with RAD byte for byte ===");
const O = oodleFrom(pub);
R.is(O.oodleAvailable() === true, "Oodle.oodleAvailable() is true in the shipped build");
const ex = await O.ensureOodle();
const out = O.oodleDecompress(ex, new Uint8Array(FIXTURE), RAW);
R.is(out.length === RAW, `it decoded the whole block — ${out.length} bytes`);
R.is(sha(out) === GOLD_SHA, "and the output is exactly what RAD produced when the golden was taken");

// THE SHAPE OF THE INPUT. DDSx pads its payload, so the entry's byte range is longer than the
// stream inside it on essentially every texture, and the bytes the app hands the decoder are a
// subarray of a larger pack read. (This is the check that found ooz's first bug: upstream threw
// away a complete decode because the caller had passed more input than the stream used.)
const padded = Buffer.concat([Buffer.alloc(4, 0xcd), FIXTURE, Buffer.alloc(64, 0xcd)]);
let paddedOk = false, paddedErr = "";
try { paddedOk = sha(O.oodleDecompress(ex, new Uint8Array(padded).subarray(4), RAW)) === GOLD_SHA; }
catch (e) { paddedErr = e.message; }
R.is(paddedOk, "an offset view with 64 bytes of trailing padding decodes to the same bytes" + (paddedErr ? " → " + paddedErr : ""));

// A short read has to be refused, not decoded into something plausible; so does a rawSize that
// is not the stream's — the caller always knows it, and a decoder that produced 262 143 bytes and
// called it done would be a texture with a wrong last byte.
const refuses = (fn) => { try { fn(); return ""; } catch (e) { return e.message; } };
const truncThrew = refuses(() => O.oodleDecompress(ex, new Uint8Array(FIXTURE.subarray(0, FIXTURE.length - 1024)), RAW));
R.is(/decompress failed/.test(truncThrew), `a truncated stream is refused rather than guessed → ${J(truncThrew.slice(0, 110))}`);
const shortThrew = refuses(() => O.oodleDecompress(ex, new Uint8Array(FIXTURE), RAW - 1));
const longThrew = refuses(() => O.oodleDecompress(ex, new Uint8Array(FIXTURE), RAW + 1));
R.is(/decompress failed/.test(shortThrew) && /decompress failed/.test(longThrew), "and so is a rawSize one byte off in either direction");
R.is(/worth reporting/.test(truncThrew), "and the refusal says which decoder it was and what to do — the whole bug report");

// RAD is the reference, and it is optional: src/vendor/oodle-b64.js is git-ignored, so a clone does
// not have it. The correctness proof above does not need it — it is a stored golden of RAD's own
// output — and this block is the live A/B for whoever does have the blob, which is what you would
// re-run after a game patch.
if (hasRad) {
  const RADD = oodleFrom(build(ROOT, { rad: true }).html);
  const rex = await RADD.ensureOodle();
  const radOut = RADD.oodleDecompress(rex, new Uint8Array(FIXTURE), RAW);
  R.is(sha(radOut) === sha(out), "RAD's decoder, run here, produces the identical bytes");

  console.log("\n=== how fast ===");
  const time = (fn, n) => { const t0 = process.hrtime.bigint(); for (let i = 0; i < n; i++) fn(); return Number(process.hrtime.bigint() - t0) / 1e6 / n; };
  const N = 5, ROUNDS = 12;
  // Warm both first: the JIT's first pass over 2 300 lines of decoder costs about as much as one
  // block, and a vehicle is hundreds of blocks. What is being measured is the decoder, not the
  // compiler — a WASM module pays its equivalent at instantiate, outside the loop, already.
  time(() => O.oodleDecompress(ex, new Uint8Array(FIXTURE), RAW), 5);
  time(() => RADD.oodleDecompress(rex, new Uint8Array(FIXTURE), RAW), 5);
  // Interleaved, and each one's BEST round: under a loaded suite one 40-block run apiece put a burst of
  // load on ours alone — 4.57× at three lanes on 2026-10-23, 3.3× alone, no decoder file changed. Round
  // by round the same load falls on both, and the minimum is what each decoder costs when it gets the
  // machine (fix plan 2026-10-23, step 7). The 4× bar is unchanged.
  let tOwn = Infinity, tRad = Infinity;
  for (let r = 0; r < ROUNDS; r++) {
    tOwn = Math.min(tOwn, time(() => O.oodleDecompress(ex, new Uint8Array(FIXTURE), RAW), N));
    tRad = Math.min(tRad, time(() => RADD.oodleDecompress(rex, new Uint8Array(FIXTURE), RAW), N));
  }
  const mbs = ms => (RAW / 1048576 / (ms / 1000)).toFixed(0);
  console.log(`  own ${tOwn.toFixed(2)} ms/block (${mbs(tOwn)} MB/s)   RAD ${tRad.toFixed(2)} ms/block (${mbs(tRad)} MB/s)   ratio ${(tOwn / tRad).toFixed(2)}×`);
  // Everything decodes in a worker pool (CLAUDE.md §3.1), so this is throughput, not UI latency —
  // the ceiling is deliberately generous and exists to catch a collapse, not to police a
  // JavaScript decoder against RAD's hand-tuned one. Measured 2026-09-14: 3.2–3.7× on this
  // fixture (120 MB/s warm), 64.6 MB/s on the clean-room bench over real textures against the
  // oracle's 261 (docs/WTLZ.md).
  R.is(tOwn < tRad * 4, `within 4× of RAD (${(tOwn / tRad).toFixed(2)}×) — a slower decode is fine, a collapsed one is not`);
} else {
  console.log("  (skipping the RAD comparison — src/vendor/oodle-b64.js is not present)");
}

// ------------------------------------------------ the real page, and the real decode worker
console.log("\n=== and it works in the page, on both threads ===");
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) {
  console.log("SKIP: no Chrome or Edge found for the browser half. Pass --chrome <path> or set CHROME.");
} else {
  const GOLD_FNV = fnv(out);
  const inject = `<script>${FNV}\nwindow.__fix = Uint8Array.from(atob(${JSON.stringify(FIXTURE.toString("base64"))}), function(c){ return c.charCodeAt(0); });</script>`;
  const BODY = `async function(){
    var out = { gold: ${GOLD_FNV} };
    out.available = Oodle.oodleAvailable();
    out.impl = Oodle.oodleImpl();
    // A release artifact that cannot say which build it is makes every bug report start with a guess
    out.stamp = (document.getElementById("buildStamp") || {}).textContent;
    // main thread, through the app's own two functions
    var ex = await Oodle.ensureOodle();
    out.mainFnv = fnv(Oodle.oodleDecompress(ex, window.__fix, ${RAW}));

    // and through the decode pool, as a texture — 262 144 bytes IS a 512×512 DXT5 surface, so this
    // is the ordinary gameTexture path with nothing special-cased for the test. The pool lifts
    // WTLZ by its marker; a section list that forgot it would fail here, in the worker.
    var body = window.__fix.slice().buffer;
    var r = await decodePool().call("gameTexture", { body: body, comp: 0x60, compName: "oodle",
      memSz: ${RAW}, packedSz: ${FIXTURE.length}, fmt: "DXT5", w: 512, h: 512, levels: 1, revMip: false }, [body]);
    out.rgbaBytes = r.rgba.byteLength;
    // DDS.writeBCnDDS puts a 128-byte header in front of the untouched compressed level 0, so what
    // follows it is exactly what the worker's Oodle step produced.
    out.workerFnv = fnv(new Uint8Array(r.dds).subarray(128));
    return out;
  }`;
  const run = await evalInPage({ browser, html: pub, inject, expr: pageExpr(BODY), timeoutMs: 90000, keep: argv.includes("--keep") });
  if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
  const r = run.result;
  if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }
  R.is(r.available === true, "the page reports a decoder");
  R.is(r.impl === "wtlz", `and it is the project's own → ${J(r.impl)}`);
  // A pre-release tag is part of a version since the line restarted at 1.0.0-beta.1 (ROADMAP 5.5(5)).
  R.is(/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)? · own decoder$/.test(r.stamp || ""), `and says on its face which decoder it has → ${J(r.stamp)}`);
  R.is(r.mainFnv === r.gold, "the main thread decodes the fixture to the golden bytes");
  R.is(r.workerFnv === r.gold, "so does the decode worker, which lifted WTLZ by its marker (CLAUDE.md §3.1)");
  R.is(r.rgbaBytes === 512 * 512 * 4, `and the whole gameTexture path completes — ${r.rgbaBytes} bytes of RGBA`);
  const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
  R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
}

// ------------------------------------------------------------- the live install (opt-in)
if (argv.includes("--install")) {
  console.log("\n=== against the live install ===");
  const { sweep, sweepGeometry } = await import("./ooz_sweep.mjs");
  const rad = hasRad ? oodleFrom(build(ROOT, { rad: true }).html) : null;
  const s = await sweep(oodleFrom(pub), rad);
  R.is(s.differing === 0, `zero differing texture outputs over ${s.compared} real payloads`);
  R.is(s.identical === s.compared, `${s.identical}/${s.compared} textures byte-identical to RAD`);
  // Geometry is the other half of "every plane and tank loads", and it is where ooz's second bug
  // lived — 375 model streams that textures could never have revealed.
  const g = await sweepGeometry(oodleFrom(pub), rad, { sample: 400 });
  R.is(g.refused === 0, `no DynModel was refused by the decoder over ${g.loaded} loaded` +
    (g.refused ? " — " + g.refusedNames.slice(0, 10).join(", ") : "") +
    ` (${g.unparsed} the model reader itself could not parse, which RAD hits too)`);
  R.is(g.differing === 0, `${g.identical}/${g.blocks} geometry blocks byte-identical, ${g.differing} differing`);
}

R.finish();
