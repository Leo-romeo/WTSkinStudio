// Does repeated work leave memory behind?
//
// Requested by the owner 2026-08-21: "the app should not leak memory to ram or static memory".
// Nothing in the suite had ever measured this. `all.mjs` mentions heaps only because it hands each
// Node test a `--max-old-space-size`, which is the opposite thing — how much a test may use, not
// whether the app gives it back.
//
// What it exercises is the hot path §3 cares about: an encode through the export worker pool. That
// one operation touches every mechanism where a leak would actually hurt — the pool, transferable
// ArrayBuffers, the WASM instances, and megabyte-scale pixel buffers — and it is the loop a user
// runs dozens of times in a session. Every few rounds the pool is cancelled, which terminates the
// workers and respawns them on the next call, because a pool that leaks a worker per cancel is the
// classic version of this bug.
//
// Why it measures the way it does:
//
//   * `--js-flags=--expose-gc`, so each reading follows a forced collection. Without it a heap
//     sample says when the collector last happened to run, not what the page is holding.
//   * `--enable-precise-memory-info`. By default Chrome BUCKETS `performance.memory` to blunt
//     fingerprinting, and the first version of this test read exactly 9.5 MB for twelve rounds
//     running - a flat line produced by the quantiser, not by the app. A test that cannot see the
//     thing it claims to measure is worse than no test, which is why the control phase below
//     exists as well.
//   * A CONTROL phase proves the instrument is live rather than assuming it. After the measured
//     rounds it repeats the same loop while deliberately RETAINING every encoded buffer, and the
//     heap is required to climb. If the control does not climb, the measurement is blind and the
//     test says so instead of passing. Same discipline as t40's "the excluded sheet's getContext
//     is never called": prove the needle moves before trusting that it didn't.
//   * Two warm-up rounds are discarded. The first encode pays for WASM instantiation, worker
//     startup and JIT, none of which is a leak, and all of which would otherwise land in the slope.
//   * The verdict is the trend across the MEASURED rounds, not an absolute number. Absolute heap
//     size varies with Chrome version and machine; growth that never stops does not.
//   * WASM memory only ever grows - `memory.grow` cannot shrink - so a few MB of one-time growth
//     is expected and is not what this is looking for. The threshold is set well above it and the
//     per-round slope is printed so a real regression is legible rather than just "FAIL".
//
// Usage: node tools/t45_memory.mjs [--keep] [--rounds N] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const ROUNDS = argv.includes("--rounds") ? +argv[argv.indexOf("--rounds") + 1] : 12;
const WARMUP = 2;
const SIDE = 512;                       // 1 MB of RGBA per round, big enough to show a retained buffer
const GROWTH_BUDGET_MB = 24;            // see the header: generous on purpose, trend is the real signal
const R = makeReport();

const BODY = `async function(){
  if (typeof performance.memory === "undefined") return { unsupported: "performance.memory" };
  if (typeof gc !== "function") return { unsupported: "gc() - was --expose-gc passed?" };
  if (typeof exportPool !== "function") return { unsupported: "exportPool" };

  var SIDE = ${SIDE}, ROUNDS = ${ROUNDS}, WARMUP = ${WARMUP};

  function settle(){ return new Promise(function(r){ setTimeout(r, 60); }); }
  async function reading(){
    // Collect twice: the first pass can resurrect objects held only by a finalizer or a detached
    // worker's message queue, and the second is what actually reports steady state.
    gc(); await settle(); gc(); await settle();
    return performance.memory.usedJSHeapSize;
  }
  function makeJob(){
    var buf = new ArrayBuffer(SIDE * SIDE * 4);
    var px = new Uint8ClampedArray(buf);
    // Real-ish content. A buffer of zeroes can be handled specially by an encoder and would make
    // this measure a path the user never takes.
    for (var i = 0; i < px.length; i += 4) {
      px[i] = (i * 7) & 255; px[i + 1] = (i * 13) & 255; px[i + 2] = (i * 3) & 255; px[i + 3] = 255;
    }
    return { op: "encodeTexture", transfer: [buf],
      args: { rgba: buf, mask: null, w: SIDE, h: SIDE, fmt: "bc3", useMips: true, renorm: false, padDist: 0 } };
  }

  var pool = exportPool();
  var samples = [], control = [], cancels = 0, bytesOut = 0, err = null;
  var retained = [];        // the control phase's deliberate leak
  try {
    for (var r = 0; r < WARMUP + ROUNDS; r++) {
      var out = await pool.map([makeJob()]);
      if (out && out[0]) bytesOut = (out[0].bytes || out[0].data || out[0]).byteLength || bytesOut;
      out = null;
      // Force a worker respawn periodically: a pool that leaks a worker per cancel shows up here
      // and nowhere else in the suite.
      if (r % 4 === 3) { pool.cancel(); cancels++; }
      if (r >= WARMUP) samples.push(await reading());
    }
    // Control: identical work, except every result is kept. This must climb.
    for (var c = 0; c < 6; c++) {
      var o2 = await pool.map([makeJob()]);
      retained.push(o2);
      // and something large and unambiguously live, so the control leaks a known quantity
      retained.push(new Uint8Array(4 * 1048576).fill(c + 1));
      control.push(await reading());
    }
  } catch (e) { err = (e && e.stack) || String(e); }

  return { samples: samples, control: control, retainedCount: retained.length,
    cancels: cancels, bytesOut: bytesOut, err: err,
    limit: performance.memory.jsHeapSizeLimit, mode: pool.mode };
}`;

const run = await evalInPage({
  browser, expr: pageExpr(BODY, 1500), timeoutMs: 180000, keep: argv.includes("--keep"),
  chromeArgs: ["--js-flags=--expose-gc", "--enable-precise-memory-info"],
});
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the page threw before it could report\n" + r.__threw); process.exit(1); }
if (r.unsupported) { console.log("SKIP: this browser does not expose " + r.unsupported); process.exit(0); }
if (r.err) { console.log("FAIL: the encode loop threw\n" + r.err); process.exit(1); }

const MB = n => (n / 1048576).toFixed(1) + " MB";
const s = r.samples || [];
if (s.length < 4) { console.log("FAIL: only " + s.length + " samples came back"); process.exit(1); }

R.ok(`${s.length} measured rounds of a ${SIDE}x${SIDE} BC3 encode through the ${r.mode} export pool ` +
  `(${r.cancels} pool cancels, ${MB(r.bytesOut)} produced per round)`);
console.log("  heap after each round: " + s.map(v => (v / 1048576).toFixed(1)).join(", ") + " MB");

// Trend, not a single difference: comparing the last sample with the first would turn one noisy
// reading into the whole verdict. Half-means are stable and still catch anything monotonic.
const half = Math.floor(s.length / 2);
const firstHalf = s.slice(0, half).reduce((a, b) => a + b, 0) / half;
const lastHalf = s.slice(-half).reduce((a, b) => a + b, 0) / half;
const growth = lastHalf - firstHalf;
const perRound = growth / (s.length - half);

R.is(growth < GROWTH_BUDGET_MB * 1048576,
  growth < GROWTH_BUDGET_MB * 1048576
    ? `heap is flat across the run: ${MB(firstHalf)} -> ${MB(lastHalf)} (${growth >= 0 ? "+" : ""}${MB(growth)}, ` +
      `${perRound >= 0 ? "+" : ""}${(perRound / 1024).toFixed(0)} KB per round, budget ${GROWTH_BUDGET_MB} MB)`
    : `heap grew ${MB(growth)} across ${s.length} rounds (${MB(perRound)} per round) — over the ` +
      `${GROWTH_BUDGET_MB} MB budget, so something is being retained between encodes`);

// A leak that is merely slower than the budget still climbs every single round. Allow one dip for
// noise; a strictly increasing series over this many rounds is not noise.
let rises = 0;
for (let i = 1; i < s.length; i++) if (s[i] > s[i - 1]) rises++;
R.is(rises < s.length - 2,
  rises < s.length - 2
    ? `no steady climb: the heap failed to rise on ${s.length - 1 - rises} of ${s.length - 1} round boundaries`
    : `the heap rose on ${rises} of ${s.length - 1} consecutive rounds — a steady climb, not noise, ` +
      `even though the total stayed inside the budget`);

// The buffers really are being handed over rather than copied. If a round produced nothing the
// numbers above would be measuring an idle page.
R.is(r.bytesOut > 0, r.bytesOut > 0 ? "each round really did encode (output is non-empty)"
  : "no encoder output came back — the loop did not do the work this test claims to measure");

// --- the control: the same loop, deliberately retaining everything ------------------------
// Without this, every assertion above is satisfied just as well by a broken measurement as by a
// clean app. Chrome buckets performance.memory unless --enable-precise-memory-info is passed, and
// a bucketed reading is a flat line whatever the page does.
const c = r.control || [];
if (c.length < 3) { console.log("  FAIL control phase produced only " + c.length + " samples"); process.exit(1); }
console.log("  control (retaining every result): " + c.map(v => (v / 1048576).toFixed(1)).join(", ") + " MB");
const controlGrowth = c[c.length - 1] - c[0];
// Six rounds retaining 4 MB each: at least ~16 MB has to show up or the instrument cannot see a
// leak of the size this test exists to catch.
R.is(controlGrowth > 16 * 1048576,
  controlGrowth > 16 * 1048576
    ? `the instrument is live: deliberately retaining ${r.retainedCount} objects moved the heap ` +
      `+${MB(controlGrowth)}, so the flat line above is the app's behaviour and not the quantiser`
    : `the control leaked ${r.retainedCount} objects and the heap moved only ${MB(controlGrowth)} — ` +
      `this measurement cannot see a leak, so the result above proves nothing ` +
      `(is --enable-precise-memory-info reaching Chrome?)`);

R.finish("\n  note  usedJSHeapSize covers the JS heap. WASM memory is separate and can only grow, so\n" +
  "        a few MB of one-time growth here is expected; an unbounded climb is not.");
