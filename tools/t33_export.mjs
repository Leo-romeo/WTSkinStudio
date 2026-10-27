// The export encode path after ROADMAP 1.3 moved it into a worker pool.
//
// The one thing that must be true: a skin encoded through the pool is BYTE-IDENTICAL to the same
// skin encoded on the main thread. Everything else about the change — parallelism, progress,
// cancellation — is worthless if the published file differs, and the published file is the whole
// product. So the test drives the real `encodeJob` + `exportPool()` against the real `encodeItem`
// on the same pixels, for every format the app can write and with seam padding on and off.
//
// It runs in a real browser because getUVMask, the DOM options and the Worker all only exist
// there. `tools/t29_encode.mjs` covers the encoders themselves against golden bytes; this covers
// the plumbing that now sits between them and the user.
//
// Usage: node tools/t33_export.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = { cases: [] };

  // A realistic sheet: flat paint, a hard keyed edge (the BC1 three-hue case) and noise.
  function sheet(w, h){
    var a = new Uint8ClampedArray(w * h * 4), seed = 99;
    function rnd(){ seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    for (var i = 0; i < w * h; i++) {
      var x = i % w, y = (i / w) | 0;
      if (y < h/3) { a[i*4]=110; a[i*4+1]=120; a[i*4+2]=82; a[i*4+3]=255; }
      else if (y < 2*h/3) { var on = x > w*0.6; a[i*4]=on?200:110; a[i*4+1]=on?40:120; a[i*4+2]=on?35:82; a[i*4+3]=on?255:0; }
      else { a[i*4]=(rnd()*256)|0; a[i*4+1]=(rnd()*256)|0; a[i*4+2]=(rnd()*256)|0; a[i*4+3]=(rnd()*256)|0; }
    }
    return a;
  }
  // A UV mask with a hole, so padSeams has a real frontier in both directions.
  function mask(w, h){
    var m = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++)
      m[y*w+x] = (x > w*0.2 && x < w*0.8 && y > h*0.2 && y < h*0.8 && !(x > w*0.45 && x < w*0.55 && y > h*0.45 && y < h*0.55)) ? 1 : 0;
    return m;
  }

  var W = 128, H = 128;
  var pool = exportPool();
  out.mode = await pool.warm();
  out.size = pool.size;

  // Drive the app's real option elements, since encodeJob reads them.
  var optMips = document.getElementById("optMips"), optPad = document.getElementById("optPad");

  // A fake slot whose UV mask is ours: getUVMask caches into slot._uvMasks, so seeding that cache
  // is enough to make the real code path use a known mask without needing a loaded model.
  function fakeSlot(w, h, withMask){
    var s = { id: "test", _uvMasks: {} };
    s._uvMasks[w + "x" + h] = withMask ? mask(w, h) : null;
    return s;
  }

  for (var mi = 0; mi < 2; mi++) {
    for (var pi = 0; pi < 2; pi++) {
      optMips.checked = mi === 1;
      optPad.checked = pi === 1;
      var fmts = ["bc3", "rgba8", "tga"];
      for (var fi = 0; fi < fmts.length; fi++) {
        var fmt = fmts[fi];
        for (var ki = 0; ki < 2; ki++) {
          var kind = ki === 0 ? "c" : "n";          // "n" turns on mip renormalisation
          var px = sheet(W, H);
          var label = fmt + " " + kind + " mips=" + optMips.checked + " pad=" + optPad.checked;

          // reference: the original main-thread encoder, on its own copy
          var refItem = { rgba: px.slice(), w: W, h: H, kind: kind, fileName: "t.dds", slot: fakeSlot(W, H, true) };
          var ref = encodeItem(refItem, fmt);

          // under test: the real job builder + the real pool
          var wrkItem = { rgba: px.slice(), w: W, h: H, kind: kind, fileName: "t.dds", slot: fakeSlot(W, H, true) };
          var job = encodeJob(wrkItem, fmt);
          var got = new Uint8Array(await pool.call(job.op, job.args, job.transfer));

          var diff = -1;
          if (ref.length !== got.length) diff = -2;
          else for (var b = 0; b < ref.length; b++) if (ref[b] !== got[b]) { diff = b; break; }
          out.cases.push({ label: label, len: ref.length, gotLen: got.length, diff: diff,
            detached: wrkItem.rgba.byteLength, fmt: fmt, kind: kind, mips: optMips.checked,
            pad: optPad.checked, sig: (function(){ var s = 0; for (var z = 0; z < got.length; z++) s = (s * 31 + got[z]) >>> 0; return s; })() });
        }
      }
    }
  }

  // ---- the pool must not be reading a stale slot mask when padding is off ----
  optMips.checked = true; optPad.checked = false;
  var noPadItem = { rgba: sheet(W, H), w: W, h: H, kind: "c", fileName: "t.dds", slot: fakeSlot(W, H, true) };
  var noPadJob = encodeJob(noPadItem, "bc3");
  out.noPadMaskSent = noPadJob.args.mask == null;

  // ---- a subarray view must be copied, not handed over with its neighbours ----
  optPad.checked = false;
  var big = sheet(W * 2, H);
  var view = new Uint8ClampedArray(big.buffer, 0, W * H * 4);        // covers only half the buffer
  var subItem = { rgba: view, w: W, h: H, kind: "c", fileName: "t.dds", slot: fakeSlot(W, H, false) };
  var subJob = encodeJob(subItem, "bc3");
  out.subarrayCopied = subJob.args.rgba.byteLength === W * H * 4;
  var subGot = new Uint8Array(await pool.call(subJob.op, subJob.args, subJob.transfer));
  var subRef = encodeItem({ rgba: view.slice(), w: W, h: H, kind: "c", fileName: "t.dds", slot: fakeSlot(W, H, false) }, "bc3");
  out.subDiff = -1;
  if (subRef.length !== subGot.length) out.subDiff = -2;
  else for (var s2 = 0; s2 < subRef.length; s2++) if (subRef[s2] !== subGot[s2]) { out.subDiff = s2; break; }

  // ---- cancellation: a cancelled map must reject and leave nothing half-written ----
  var many = [];
  for (var c = 0; c < 30; c++) {
    var ci = { rgba: sheet(W, H), w: W, h: H, kind: "c", fileName: "t.dds", slot: fakeSlot(W, H, false) };
    many.push(encodeJob(ci, "bc3"));
  }
  var cancelled = false;
  var p = pool.map(many, function(){}, function(){ return true; });   // "already cancelled"
  try { await p; } catch (e) { cancelled = /cancel/i.test(e.message); }
  out.cancelRejects = cancelled;

  pool.dispose();
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 500), timeoutMs: 180000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log(`export pool: mode "${r.mode}", ${r.size} workers · ${r.cases.length} format/option combinations`);
let worst = null;
for (const c of r.cases) {
  if (c.diff === -1) continue;
  worst = worst || c;
}
R.is(!worst, worst
  ? `worker output differs from the main thread: ${worst.label} — ${worst.diff === -2 ? `length ${worst.gotLen} vs ${worst.len}` : `byte ${worst.diff} of ${worst.len}`}`
  : `all ${r.cases.length} combinations are byte-identical between the worker and the main thread`);
// spell out the coverage, so a shrinking matrix is visible rather than silently passing
console.log("  note  " + r.cases.map(c => c.label + " (" + c.len + "B)").join("\n        "));

R.is(r.cases.every(c => c.detached === 0), "every job transferred its pixel buffer rather than cloning it");
// The albedo and the surface map differ only by `renorm`, which BCnEnc.buildMips applies to the mip
// levels it generates. If that flag never reached the worker the two would come out identical and
// every byte-equality check above would still pass — so assert the difference directly.
{
  const pick = (kind) => r.cases.find(c => c.fmt === "bc3" && c.kind === kind && c.mips && !c.pad);
  const c = pick("c"), n = pick("n");
  R.is(c && n && c.sig !== n.sig,
    c && n ? `the kind="n" renormalise flag reaches the worker: albedo hashes ${c.sig}, surface map ${n.sig}`
      : "could not find the bc3/mips cases to compare");
}
R.is(r.noPadMaskSent, "with seam padding off, no mask is sent at all");
R.is(r.subarrayCopied, "a subarray view is copied to an exact buffer instead of handing over its neighbours");
R.is(r.subDiff === -1, r.subDiff === -1 ? "a subarray-backed texture still encodes identically"
  : `a subarray-backed texture differs at byte ${r.subDiff}`);
R.is(r.cancelRejects, "a cancelled encode rejects rather than returning a partial result");

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
