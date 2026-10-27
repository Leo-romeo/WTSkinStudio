/*==REC==*/
// ---------- Session recording: what the machine saw, next to what you felt ----------
//
// Every performance number in this project until 2026-08-23 came from a synthetic harness: a
// placeholder sheet, `stampAt` called directly, no model, no raycasting, no pointer events. That
// found a real 47 ms stall (ROADMAP 1.6) — and it cannot see the 3-D paint path at all, where each
// pointer move fires up to 24 raycasts against a real mesh. This is the instrument for that: paint
// on a real vehicle for a minute, then read the log against your own account of how it felt.
//
// THREE THINGS SHAPE WHAT IS RECORDED HERE, and none of them is obvious.
//
// 1. **It must not measure itself.** The honest way to time canvas work is a sync barrier — a 1×1
//    `getImageData` before and after, because canvas calls are queued and a naive timer measures
//    the previous call's backlog (CLAUDE.md §3). Doing that live would drain the GPU pipeline on
//    every stroke and make the session slower than the thing being diagnosed. So nothing here
//    times a phase. It records **frame gaps**, which is what a stall actually is from the user's
//    side, and counters that cost nothing to keep.
//
// 2. **Your impression has to be anchored in time.** "It stuttered sometimes" over three minutes
//    cannot be joined to anything. **F9 drops a marker** — press it the moment something feels
//    wrong. That is the whole point of the feature: it turns an impression into a timestamp that
//    sits beside the frame log.
//
// 3. **Nothing leaves the machine** (CLAUDE.md §0.1). Stopping writes a .json to your downloads.
//    Nothing is sent anywhere, and there is no automatic anything — you choose to hand it over.
//
// Cost when off: one `if (!Rec.on) return;` per call site.
//
// 4. **Where a stroke's time went** (2026-10-22). Note 1 still holds — nothing here drains the GPU —
//    but frame gaps and counters alone could not answer the question every session ends on. The
//    su_34 session that day said stroke 1 blocked the page for 7 s over 10 911 dabs and 961 rays,
//    and nothing in it could say whether the dabs, the rays, the stencils or the composite were the
//    7 s — so the next step was an afternoon rebuilding the stroke in a headless probe. Each phase
//    of a stroke is now a `performance.now()` pair (`Rec.clock` / `Rec.span`): tens of nanoseconds a
//    call, about a millisecond over 10 000 dabs. The one thing it cannot see is canvas work the
//    browser queues on the GPU and runs later: that is billed to whatever forces it (usually
//    `render`, which uploads the sheet), not to the dab that queued it. Read a phase as where the
//    main thread WAS, and `blockedMs` as the total it could not answer input.
//    A long task in the two seconds after a stroke is put down to it (`after`): the 560 ms gaps
//    that followed stroke 1 in that session were attributed to nothing. Both are decided by WHEN a
//    stall began, not by what was open when it was reported — see `whose`.
const Rec = { on: false, t0: 0, lastFrame: 0, raf: 0, obs: null,
              frames: [], marks: [], strokes: [], notes: [], cur: null, worst: 0,
              AFTER_MS: 2000 };   // how long after a stroke ends a stall is still put down to it (note 4)

const REC_FRAME_MS = 20;        // longer than a 60 Hz frame with room for noise — a dropped frame
const REC_MAX = 4000;           // cap every list, so a long session cannot grow without bound

function recPush(list, v){ if (list.length < REC_MAX) list.push(v); }
function recNow(){ return +(performance.now() - Rec.t0).toFixed(1); }
// What was switched on. Each of these changes what a stroke costs — Radial multiplies every dab and
// its raycasts by the copy count, the sheet mirror adds a lookup per dab, and the tool/channel/target
// triple decides which sheet a dab lands on — and each can change mid-session, so it is taken per
// stroke as well as once at the start. Until 2026-09-24 none of it was recorded, and the one session
// on file predates Radial and the sheet mirror both (ROADMAP 1.8's follow-up; 1.9's BVH question is
// read off exactly these counters).
//
// Flow, Build up and Smoothing (ROADMAP 4.50 (4) + 6.4) change nothing about what a stroke costs, but
// "the brush felt wrong" cannot be read against a log that does not say how the brush was set.
//
// Size, spacing, opacity and hardness are per stroke as well since 2026-10-22: the su_34 session ran
// at 5 % spacing — three times the default's dabs — and said so only once, in the context block.
function recSettings(){
  const s = App.activeSlot, b = App.brush;
  return { size: b.size, spacing: b.spacing, opacity: b.opacity, hardness: b.hardness,
           tool: b.tool, chan: b.chan, target: b.target, radial: radialCount(),
           sym: !!symEnabled(), sheetMirror: !!(s && Mirror.ready(s)),
           flow: b.flow, build: !!b.build, lazy: b.lazy || 0,
           // ROADMAP 4.50 (10): the tip each dab was laid in — a loaded one as "image", never by its
           // file's name — and what varied from dab to dab, since a turned or scattered dab costs more.
           tip: Tips.isBuilt(Tips.of(b).id) ? Tips.of(b).id : "image", jitter: [b.sizeJit || 0, b.flowJit || 0, b.angleJit || 0],
           scatter: b.scatter || 0, follow: !!b.follow };
}

// What the machine is, what is loaded, and what the brush is set to — all of it changes the
// numbers, and none of it is guessable from the log afterwards.
function recContext(){
  const s = App.activeSlot;
  // `tris` — buildGeometryData puts the triangle count on every group and it is the number that
  // decides what a raycast costs. Guessed at twice before reading the builder (`idx`, then `v`),
  // and both guesses silently reported 0 in a real session. Read the field that exists.
  const tris = App.geomData ? App.geomData.reduce((n, g) => n + (g.tris || 0), 0) : 0;
  return {
    version: APP_VERSION, decoder: Oodle.oodleImpl() || "none",
    ua: navigator.userAgent, cores: navigator.hardwareConcurrency || null,
    memoryGB: navigator.deviceMemory || null,
    view: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    model: App.objName || App.vehicleKey || null,
    parts: App.meshes ? App.meshes.size : 0, triangles: Math.round(tris),
    // `layers` is LEAVES: since groups (4.9) `s.layers.length` counts top-level nodes, and one group
    // of twenty layers read as "1 layer" — the number that decides what a composite costs, understated
    // twenty times. `nodes` keeps the top-level count beside it.
    slot: s ? { id: s.id, w: s.composite ? s.composite.width : 0, h: s.composite ? s.composite.height : 0,
                layers: layerLeaves(s.layers).length, nodes: s.layers.length } : null,
    brush: Object.assign({ mode: App.brush.mode, size: App.brush.size, opacity: App.brush.opacity,
             hardness: App.brush.hardness, spacing: App.brush.spacing }, recSettings()),
    // `symEnabled()` returns the model GROUP when symmetry is on, not a boolean. Coerce it — this
    // object is about to be JSON.stringify'd, and a THREE.Group in there is a circular structure
    // that would throw and take the whole recording with it.
    paint3d: !!App.paint3d, symmetry: !!symEnabled(),
  };
}

function recStart(){
  if (Rec.on) return;
  Object.assign(Rec, { on: true, t0: performance.now(), lastFrame: performance.now(),
                       frames: [], marks: [], strokes: [], notes: [], cur: null, worst: 0 });
  Rec.context = recContext();
  // A frame gap is the user-visible unit of "it froze". Only gaps past the threshold are kept, so
  // a smooth minute costs a handful of entries rather than 3 600.
  const tick = () => {
    if (!Rec.on) return;
    const t = performance.now(), gap = t - Rec.lastFrame;
    Rec.lastFrame = t;
    if (gap > REC_FRAME_MS) {
      if (gap > Rec.worst) Rec.worst = gap;
      recPush(Rec.frames, Rec.whose({ t: +(t - Rec.t0).toFixed(1), gap: +gap.toFixed(1) }, t - gap - Rec.t0));
    }
    Rec.raf = requestAnimationFrame(tick);
  };
  Rec.raf = requestAnimationFrame(tick);
  // The browser's own view of a blocked main thread. Long tasks are ≥50 ms by spec, so this adds
  // attribution for the big ones; the rAF gaps above are what catch the 20–40 ms hitches.
  try {
    Rec.obs = new PerformanceObserver(list => {
      for (const e of list.getEntries()) recPush(Rec.frames, Rec.whose({ t: +(e.startTime - Rec.t0).toFixed(1), gap: +e.duration.toFixed(1), longtask: true }));
    });
    Rec.obs.observe({ entryTypes: ["longtask"] });
  } catch (e) { Rec.obs = null; }                    // not in every browser; the rAF loop stands alone
  setStatus("Recording — paint as you normally would, and press F9 the moment anything feels wrong", "ok");
  recSyncUI();
}

// One entry per stroke: how much work it actually was. Counters only — see note 1 above. `pen` is
// whether a pen drove it (4.50 (4)): a pen's coalesced samples are more pointer moves' worth of
// input per frame, so a session with one is not the same workload as a mouse's. `shared` counts the
// 3-D copies that landed on a dab the same sub-step had already laid — a part and its twin painting
// from one set of texels — and so were not laid twice (stamp3d).
function recStrokeBegin(where){
  if (!Rec.on) return;
  Rec.cur = Object.assign({ id: Rec.strokes.length + 1, t: recNow(), where: where, moves: 0, substeps: 0,
              stamps: 0, rays: 0, hits: 0, shared: 0, madeLayer: false, pen: false, time: {} }, recSettings());
}
function recStrokeCount(what, n){ if (Rec.on && Rec.cur) Rec.cur[what] += (n === undefined ? 1 : n); }
function recStrokeFlag(what){ if (Rec.on && Rec.cur) Rec.cur[what] = true; }
// Note 4. `const t0 = Rec.clock(); work(); Rec.span("dab", t0);` — 0 when not recording a stroke, and
// Rec.span ignores a 0, so the cost when off is the one test. Each phase keeps its total, its count
// and its worst single call: "move" is one pointer move's whole handler, so its `max` is the worst
// hitch a stroke put under the pointer. The phases a 3-D stroke has (rays inside a move, dabs and
// stencils inside a ray's hit) nest, so they do not sum to `move`.
Object.assign(Rec, {
  clock(){ return Rec.on && Rec.cur ? performance.now() : 0; },
  span(what, t0){
    if (!t0 || !Rec.cur) return;
    const ms = performance.now() - t0, c = Rec.cur.time;
    const e = c[what] || (c[what] = { ms: 0, n: 0, max: 0 });
    e.ms += ms; e.n++; if (ms > e.max) e.max = ms;
  },
});
function recStrokeEnd(){
  if (!Rec.on || !Rec.cur) return;
  Rec.cur.ms = +(recNow() - Rec.cur.t).toFixed(1);
  for (const k in Rec.cur.time) { const e = Rec.cur.time[k]; e.ms = +e.ms.toFixed(1); e.max = +e.max.toFixed(1); }
  recPush(Rec.strokes, Rec.cur);
  Rec.cur = null;
}
// Which stroke a frame gap belongs to: the one it began during, or else the one that ended less than
// AFTER_MS before it began (note 4). By its START time (`at`), not by what was open when it was
// reported: the browser hands a long task over only after it has ended, so the 165 ms of putting a
// stroke down — the stroke's own "end" phase — arrived with no stroke open, and the first recording
// with phases (su_34, 2026-10-22 12:27) said "blocked 0 ms" of strokes that had each stalled 165 ms.
Object.assign(Rec, {
  whose(f, at){
    if (at == null) at = f.t;
    const S = Rec.strokes;
    f.stroke = Rec.cur && at >= Rec.cur.t - 1 ? Rec.cur.id : null;
    for (let i = S.length - 1; i >= 0 && i >= S.length - 4 && f.stroke == null; i--) {
      const s = S[i], end = s.t + s.ms;
      if (at >= s.t - 1 && at <= end + 1) f.stroke = s.id;
      else if (at > end && at - end < Rec.AFTER_MS && f.after == null) f.after = s.id;
    }
    if (f.stroke != null) delete f.after;
    return f;
  },
  // What each stroke cost, said in a line a person can read, longest phase first — so the file
  // answers "what was slow" on its own, before anyone opens `frames`. Long tasks only for `blockedMs`:
  // a rAF gap and the long task behind it are the same stall recorded twice.
  summary(strokes, frames){
    const ms = v => v >= 1000 ? (v / 1000).toFixed(1) + " s" : Math.round(v) + " ms";
    const lt = frames.filter(f => f.longtask);
    return strokes.map(s => {
      s.blockedMs = Math.round(lt.filter(f => f.stroke === s.id).reduce((a, f) => a + f.gap, 0));
      s.afterMs = Math.round(lt.filter(f => f.after === s.id).reduce((a, f) => a + f.gap, 0));
      const ph = Object.entries(s.time || {}).filter(([k]) => k !== "move").sort((a, b) => b[1].ms - a[1].ms)
        .filter(([, e]) => e.ms >= 1).map(([k, e]) => k + " " + ms(e.ms) + " (" + e.n + " × " + (e.ms / e.n).toFixed(2) + " ms)");
      const mv = s.time && s.time.move;
      return "stroke " + s.id + " (" + s.where + ", " + s.moves + " moves, size " + s.size + ", spacing " +
        Math.round((s.spacing || 0) * 100) + " %): blocked " + ms(s.blockedMs) + " of " + ms(s.ms) +
        (mv ? ", worst move " + ms(mv.max) : "") + (ph.length ? " — " + ph.join(", ") : "") +
        (s.afterMs ? "; " + ms(s.afterMs) + " blocked after it ended" : "");
    });
  },
});
// F9. `label` is optional; the timestamp is the point.
function recMark(label){
  if (!Rec.on) { setStatus("Not recording — start one under View & scene ▸ Advanced", "err"); return; }
  recPush(Rec.marks, { t: recNow(), stroke: Rec.cur ? Rec.cur.id : null, label: label || "" });
  setStatus("Marked at " + (recNow() / 1000).toFixed(1) + " s — " + Rec.marks.length + " so far. Say what it was when you send the file.", "ok");
}

function recStop(){
  if (!Rec.on) return null;
  Rec.on = false;
  cancelAnimationFrame(Rec.raf);
  if (Rec.obs) { try { Rec.obs.disconnect(); } catch (e) { /* already gone */ } }
  const out = {
    what: "WT Skin Studio session recording. Frame gaps, per-stroke counters and where each stroke's " +
          "time went, plus the moments the user marked with F9. Written locally and never sent anywhere.",
    recordedAt: new Date().toISOString(),
    durationS: +(recNow() / 1000).toFixed(1),
    context: Rec.context,
    worstFrameMs: +Rec.worst.toFixed(1),
    droppedFrames: Rec.frames.length,
    summary: Rec.summary(Rec.strokes, Rec.frames),
    marks: Rec.marks,
    strokes: Rec.strokes,
    frames: Rec.frames,
    // Left empty on purpose: this is where the part no instrument can capture goes.
    howItFelt: "",
  };
  recSyncUI();
  return out;
}
/*==ENDREC==*/
