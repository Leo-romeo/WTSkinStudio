/*==POOL==*/
// ---------- Running the page's own code off the UI thread ----------
// A single-file app has no .js file to point a Worker at, so a worker's source is lifted out of
// the page itself at run time: the same `/*==SECTION==*/` markers the offline tests use, read back
// out of `document.scripts` and handed to a `blob:` URL. That gives ONE source of truth — the
// codec a worker runs is literally the same text the main thread runs, so the two cannot drift,
// and there is no build step to keep them in sync.
//
// Measured 2026-08-04 (`tools/t31_boot.mjs`): a Worker built from a `blob:` URL does construct on
// a `file://` page in Chrome, which is what makes any of this possible in a double-clicked file.
// Where it is not possible — a browser with stricter file:// rules, or workers disabled — the pool
// degrades to running the identical dispatch table inline on the main thread. Callers never
// branch on which happened; they lose the parallelism, not the feature.
//
// Everything crossing the boundary goes as a transferable. A 4096² sheet is 67 MB and
// structured-cloning it would cost more than the work being moved.
const POOL_MAX = 8;
function poolSize(){ return Math.max(1, Math.min(POOL_MAX, (navigator.hardwareConcurrency || 4) - 1)); }

// The page's marked sections, read back out of its own inline scripts. Where a name appears more
// than once — a comment elsewhere in the page mentions `/*==ZSTD==*/` in prose — the longest
// complete body wins, so a mention can never shadow the real section.
let _sectionsCache = null;
function pageSections(){
  if (_sectionsCache) return _sectionsCache;
  const m = new Map();
  for (const s of document.scripts) {
    if (s.src) continue;
    const t = s.textContent;
    const re = /\/\*==([A-Z0-9]+)==\*\//g;
    let x;
    while ((x = re.exec(t))) {
      if (x[1].startsWith("END")) continue;
      const end = t.indexOf("/*==END" + x[1] + "==*/", x.index);
      if (end < 0) continue;                                   // a prose mention, not a section
      const body = t.slice(x.index + x[0].length, end);
      if (!m.has(x[1]) || m.get(x[1]).length < body.length) m.set(x[1], body);
    }
  }
  return (_sectionsCache = m);
}
function sectionSource(names){
  const secs = pageSections();
  return names.map(n => {
    const b = secs.get(n);
    if (b == null) throw new Error("section " + n + " is not in the page — a marker was moved or renamed");
    return "// ---- " + n + " ----\n" + b;
  }).join("\n");
}

// Two pieces on purpose: `core` is the code, `core + dispatch` is what a worker runs. The inline
// fallback evaluates `core` alone, so it never has to strip the message plumbing back out with a
// regex over source that may contain the same words.
function poolSource(cfg){
  const core = sectionSource(cfg.sections || []) + "\n" + (cfg.ops || "");
  return { core, src: core + `
self.onmessage = function(e){
  var d = e.data;
  if (d && d.__ping) { self.postMessage({ __pong: 1 }); return; }
  var fail = function(err){ self.postMessage({ id: d.id, ok: false, error: (err && err.message) || String(err) }); };
  var send = function(out){
    var res = (out && out.__t) ? out.result : out;
    var xfer = (out && out.__t) ? (out.transfer || []) : [];
    // A non-cloneable result would otherwise throw out of onmessage and reach the caller as
    // "worker failed: unknown", with the real reason lost.
    try { self.postMessage({ id: d.id, ok: true, result: res }, xfer); } catch (err) { fail(err); }
  };
  // An op may be async. Two of the decode ops have no choice: Oodle instantiates its WASM
  // through WebAssembly.compile and the zlib path goes through DecompressionStream. Resolving
  // it here keeps that invisible to callers — a synchronous op still replies in the same task.
  try {
    var out = WT_OPS[d.op](d.args);
    if (out && typeof out.then === "function") out.then(send, fail);
    else send(out);
  } catch (err) { fail(err); }
};` };
}
// Wire one worker's replies back to the job that is waiting for them. A worker that DIES takes its
// job with it, so that job is failed loudly — leaving the caller's promise pending forever is
// indistinguishable from a hang.
function poolAttach(P, w, drain){
  w.busy = null;
  w.onmessage = e => {
    if (e.data && e.data.__pong) return;
    const job = P.pending.get(e.data.id);
    P.pending.delete(e.data.id);
    w.busy = null;
    if (job) (e.data.ok ? job.resolve(e.data.result) : job.reject(new Error(e.data.error)));
    drain();
  };
  w.onerror = ev => {
    const job = w.busy && P.pending.get(w.busy);
    if (job) { P.pending.delete(w.busy); job.reject(new Error("[" + P.name + "] worker failed: " + (ev.message || "unknown"))); }
    w.busy = null;
    drain();
  };
  return w;
}
// A pool of workers all running the same source. `ops` is appended to it and must define a
// `WT_OPS` object of `name -> fn(args) -> result | { __t:1, result, transfer:[] }`.
function makeWorkerPool(cfg){
  const { core, src } = poolSource(cfg);
  const P = {
    name: cfg.name || "pool",
    size: cfg.size || poolSize(),
    workers: [], queue: [], pending: new Map(), nextId: 1,
    url: null, inline: null, mode: "unstarted",
  };
  // The inline path is not a stub: it is the same source evaluated here, so a browser without
  // workers runs identical code and produces identical bytes — just on this thread.
  const goInline = why => {
    P.mode = "inline";
    P.why = why;
    if (!P.inline) P.inline = new Function(core + "\nreturn WT_OPS;")();
    if (why) console.warn("[" + P.name + "] running on the UI thread: " + why);
  };
  const start = () => {
    if (P.mode !== "unstarted") return;
    try {
      P.url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      for (let i = 0; i < P.size; i++) P.workers.push(poolAttach(P, new Worker(P.url), drain));
      P.mode = "worker";
    } catch (e) {
      for (const w of P.workers) { try { w.terminate(); } catch (err) { /* already gone */ } }
      P.workers.length = 0;
      goInline(e.message);
    }
  };
  const drain = () => {
    while (P.queue.length) {
      const w = P.workers.find(x => !x.busy);
      if (!w) return;
      const job = P.queue.shift();
      w.busy = job.id;
      P.pending.set(job.id, job);
      try { w.postMessage({ id: job.id, op: job.op, args: job.args }, job.transfer || []); }
      catch (e) { P.pending.delete(job.id); w.busy = null; job.reject(e); }
    }
  };
  P.call = (op, args, transfer) => {
    start();
    if (P.mode === "inline") {
      // still a promise, and still asynchronous, so callers cannot accidentally depend on the
      // synchronous case and then break when a real worker is available
      return new Promise((resolve, reject) => setTimeout(() => {
        try {
          const out = P.inline[op](args);
          if (out && typeof out.then === "function") out.then(o => resolve(o && o.__t ? o.result : o), reject);
          else resolve(out && out.__t ? out.result : out);
        } catch (e) { reject(e); }
      }, 0));
    }
    return new Promise((resolve, reject) => {
      P.queue.push({ id: P.nextId++, op, args, transfer, resolve, reject });
      drain();
    });
  };
  P.map = (jobs, onProgress, isCancelled) => poolMap(P, jobs, onProgress, isCancelled);
  // Cancelling means the in-flight work must actually stop, and a worker mid-BC3-encode cannot be
  // interrupted any other way. The pool respawns on the next call.
  P.cancel = () => {
    for (const job of P.queue) job.reject(new Error("cancelled"));
    P.queue.length = 0;
    for (const job of P.pending.values()) job.reject(new Error("cancelled"));
    P.pending.clear();
    P.dispose();
  };
  P.dispose = () => {
    for (const w of P.workers) { try { w.terminate(); } catch (e) { /* already gone */ } }
    P.workers.length = 0;
    if (P.url) { URL.revokeObjectURL(P.url); P.url = null; }
    if (P.mode === "worker") P.mode = "unstarted";
  };
  P.warm = async () => { start(); return poolWarm(P); };
  return P;
}
// Run a batch at pool width, reporting progress as each job finishes and checking cancellation
// between them. Results come back in JOB order however they complete — the caller pairs them with
// its own input list, so out-of-order results would silently mislabel every file.
async function poolMap(P, jobs, onProgress, isCancelled){
  const out = new Array(jobs.length);
  let next = 0, done = 0;
  const lanes = Math.max(1, Math.min(P.mode === "inline" ? 1 : P.size, jobs.length || 1));
  const lane = async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      if (isCancelled && isCancelled()) throw new Error("cancelled");
      out[i] = await P.call(jobs[i].op, jobs[i].args, jobs[i].transfer);
      done++;
      if (onProgress) onProgress(done, jobs.length, jobs[i]);
    }
  };
  await Promise.all(Array.from({ length: lanes }, lane));
  return out;
}
// Each worker instantiates its own WASM at top level (~30 ms for zstd). Paying that here keeps it
// off the first real job, which is the one the user is watching.
async function poolWarm(P){
  if (P.mode === "inline") return P.mode;
  await Promise.all(P.workers.map(w => new Promise(res => {
    const t = setTimeout(res, 4000);
    const h = e => { if (e.data && e.data.__pong) { clearTimeout(t); w.removeEventListener("message", h); res(); } };
    w.addEventListener("message", h);
    w.postMessage({ __ping: 1 });
  })));
  return P.mode;
}
/*==ENDPOOL==*/
