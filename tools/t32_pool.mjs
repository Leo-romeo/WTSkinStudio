// The worker pool (ROADMAP 1.1), run in a real browser on a real file:// page.
//
// The interesting claim is not "a worker replies". It is that a worker running source LIFTED OUT
// OF THE PAGE produces byte-identical output to the same function on the main thread — that is the
// whole reason the pool takes its code from `/*==SECTION==*/` markers rather than from a second
// copy that would drift. So the central check encodes a texture both ways and compares every byte.
//
// Also asserted: buffers really transfer rather than clone (a 4096² sheet is 67 MB; cloning it
// would cost more than the work being moved), work is spread over more than one worker, `map`
// returns results in job order whatever order they finish in, a throwing op rejects instead of
// hanging, cancellation rejects the queue, and the inline fallback — the path a browser without
// workers takes — produces the SAME bytes as the worker path.
//
// Usage: node tools/t32_pool.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {};
  var pool = makeWorkerPool({
    name: "test",
    sections: ["BCNDEC", "BCNENC"],
    // WHO is a per-worker identity minted when the worker's source evaluates. Returning it with
    // every job is what proves the work really was spread, without timing anything.
    ops: [
      "var WHO = Math.random().toString(36).slice(2);",
      "var WT_OPS = {",
      "  encode: function(a){ var r = encodeBC3(new Uint8ClampedArray(a.rgba), a.w, a.h); return { __t: 1, result: r.buffer, transfer: [r.buffer] }; },",
      "  echo: function(a){ return a.n * 2; },",
      "  work: function(a){ var img = new Uint8ClampedArray(256*256*4); for (var i=0;i<img.length;i++) img[i] = (i*a.i) & 255; var r = encodeBC3(img, 256, 256); return { i: a.i, who: WHO, sum: r[0] + r[15] }; },",
      "  boom: function(){ throw new Error('deliberate'); }",
      "};"
    ].join("\\n")
  });
  out.mode = await pool.warm();
  out.size = pool.size;
  out.hw = navigator.hardwareConcurrency;

  // ---- 1. round trip ----
  out.echo = await pool.call("echo", { n: 21 });

  // ---- 2. the worker's encodeBC3 must match the main thread's, byte for byte ----
  var w = 64, h = 64;
  var img = new Uint8ClampedArray(w * h * 4);
  var seed = 12345;
  function rnd(){ seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  for (var i = 0; i < w * h; i++) {
    // patchwork: a flat region, a hard keyed edge, then noise — a uniform fill proves nothing
    var x = i % w, y = (i / w) | 0;
    if (y < 16) { img[i*4] = 110; img[i*4+1] = 120; img[i*4+2] = 82; img[i*4+3] = 255; }
    else if (y < 32) { var on = x > 40; img[i*4] = on ? 200 : 110; img[i*4+1] = on ? 40 : 120; img[i*4+2] = on ? 35 : 82; img[i*4+3] = on ? 255 : 0; }
    else { img[i*4] = (rnd()*256)|0; img[i*4+1] = (rnd()*256)|0; img[i*4+2] = (rnd()*256)|0; img[i*4+3] = (rnd()*256)|0; }
  }
  var here = encodeBC3(img, w, h);                        // main thread, the page's own function
  var sendBuf = img.slice().buffer;                       // a copy, so the source stays readable
  var got = await pool.call("encode", { rgba: sendBuf, w: w, h: h }, [sendBuf]);
  out.transferred = sendBuf.byteLength;                   // 0 iff it really was transferred
  var there = new Uint8Array(got);
  out.encLen = [here.length, there.length];
  out.encDiff = -1;
  for (var k = 0; k < here.length; k++) if (here[k] !== there[k]) { out.encDiff = k; break; }

  // ---- 3. map: order preserved, work spread over the pool ----
  var jobs = [];
  for (var j = 0; j < 16; j++) jobs.push({ op: "work", args: { i: j + 1 } });
  var prog = [];
  var mapped = await pool.map(jobs, function(d){ prog.push(d); });
  out.mapped = mapped.map(function(m){ return m.i; });
  out.workers = Array.from(new Set(mapped.map(function(m){ return m.who; }))).length;
  out.progressCalls = prog.length;

  // ---- 4. an op that throws must reject, not hang ----
  try { await pool.call("boom", {}); out.boom = "resolved (wrong)"; }
  catch (e) { out.boom = e.message; }

  // ---- 5. cancel rejects everything queued and in flight ----
  var queued = [];
  for (var c = 0; c < 40; c++) queued.push(pool.call("work", { i: c + 1 }).then(function(){ return "ok"; }, function(e){ return e.message; }));
  pool.cancel();
  var settled = await Promise.all(queued);
  out.cancelled = settled.filter(function(v){ return v === "cancelled"; }).length;
  out.cancelTotal = settled.length;

  // ---- 6. the inline fallback must produce the SAME bytes ----
  var inlinePool = makeWorkerPool({
    name: "inline-test", sections: ["BCNDEC", "BCNENC"],
    ops: "var WT_OPS = { encode: function(a){ var r = encodeBC3(new Uint8ClampedArray(a.rgba), a.w, a.h); return { __t: 1, result: r.buffer, transfer: [r.buffer] }; } };"
  });
  var realWorker = window.Worker;
  window.Worker = function(){ throw new Error("simulated: no workers here"); };
  try {
    await inlinePool.call("encode", { rgba: img.slice().buffer, w: 4, h: 4 });   // triggers start()
    out.inlineMode = inlinePool.mode;
    var inlineOut = new Uint8Array(await inlinePool.call("encode", { rgba: img.slice().buffer, w: w, h: h }));
    out.inlineLen = inlineOut.length;
    out.inlineDiff = -1;
    for (var q = 0; q < here.length; q++) if (here[q] !== inlineOut[q]) { out.inlineDiff = q; break; }
  } finally { window.Worker = realWorker; }

  // ---- 7. section lifting itself ----
  var secs = pageSections();
  out.sections = Array.from(secs.keys()).sort();
  out.zstdLen = (secs.get("ZSTD") || "").length;          // a prose mention must not shadow it
  out.encInEnc = /function encodeBC3/.test(secs.get("BCNENC") || "");
  out.encNotInDds = !/function encodeBC3/.test(secs.get("DDS") || "");
  try { sectionSource(["NOPE"]); out.missing = "no throw (wrong)"; }
  catch (e) { out.missing = e.message; }

  pool.dispose(); inlinePool.dispose();
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 400), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log(`browser reports ${r.hw} cores; pool size ${r.size}; mode "${r.mode}"`);
R.is(r.mode === "worker", `pool spawned real workers on a file:// page (mode "${r.mode}")`);
R.is(r.size === Math.max(1, Math.min(8, (r.hw || 4) - 1)), `pool size ${r.size} = min(8, hardwareConcurrency-1) with ${r.hw} cores`);
R.is(r.echo === 42, `round trip through a worker returned ${r.echo} (expect 42)`);

R.is(r.encDiff === -1 && r.encLen[0] === r.encLen[1],
  r.encDiff === -1 ? `worker encodeBC3 is byte-identical to the main thread's (${r.encLen[0]} bytes) — the section lift is faithful`
    : `worker encodeBC3 differs from the main thread at byte ${r.encDiff} (lengths ${r.encLen.join(" vs ")})`);
R.is(r.transferred === 0, `the source buffer was transferred, not cloned (byteLength after post = ${r.transferred})`);

const inOrder = Array.from({ length: 16 }, (_, i) => i + 1);
R.is(JSON.stringify(r.mapped) === JSON.stringify(inOrder),
  `map returns results in job order whatever order they finish in (${r.mapped.length} jobs)`);
R.is(r.progressCalls === 16, `progress fired once per job (${r.progressCalls}/16)`);
// Identity, not timing: each worker mints an id when its source evaluates and every job says which
// one ran it. That is a fact about scheduling; a wall-clock speedup is a fact about the machine.
if (r.size > 1) R.is(r.workers > 1, `16 jobs were spread across ${r.workers} of ${r.size} workers`);
else console.log("  note  single-worker pool on this machine, no spread to measure");

R.is(r.boom === "deliberate", `an op that throws rejects with its message ("${r.boom}")`);
R.is(r.cancelled === r.cancelTotal, `cancel() rejected all ${r.cancelled}/${r.cancelTotal} jobs, queued and in flight`);

R.is(r.inlineMode === "inline", `with Worker unavailable the pool degrades to inline (mode "${r.inlineMode}")`);
R.is(r.inlineDiff === -1 && r.inlineLen === r.encLen[0],
  r.inlineDiff === -1 ? "the inline fallback produces byte-identical output to the worker path"
    : `the inline fallback differs at byte ${r.inlineDiff}`);

// Each module is one section, so a section names exactly what it holds: the encoders are in
// BCNENC and are NOT in DDS. That is what lets the decode pool stop carrying them (ROADMAP 2.2).
R.is(r.encInEnc, "the BCNENC section lifted out of the page contains encodeBC3");
R.is(r.encNotInDds, "and the DDS section does not — one module, one section, no overlap");
R.is(r.zstdLen > 1000, `ZSTD resolved to the real section body (${r.zstdLen} chars), not the prose mention of it`);
R.is(/is not in the page/.test(r.missing), `a missing section throws a clear error ("${r.missing}")`);
console.log(`  note  sections found: ${r.sections.join(", ")}`);

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
