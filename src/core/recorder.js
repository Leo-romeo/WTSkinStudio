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
const Rec = { on: false, t0: 0, lastFrame: 0, raf: 0, obs: null,
              frames: [], marks: [], strokes: [], notes: [], cur: null, worst: 0 };

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
function recSettings(){
  const s = App.activeSlot, b = App.brush;
  return { tool: b.tool, chan: b.chan, target: b.target, radial: radialCount(),
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
    version: APP_VERSION, decoder: oodleImpl() || "none",
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
      recPush(Rec.frames, { t: +(t - Rec.t0).toFixed(1), gap: +gap.toFixed(1), stroke: Rec.cur ? Rec.cur.id : null });
    }
    Rec.raf = requestAnimationFrame(tick);
  };
  Rec.raf = requestAnimationFrame(tick);
  // The browser's own view of a blocked main thread. Long tasks are ≥50 ms by spec, so this adds
  // attribution for the big ones; the rAF gaps above are what catch the 20–40 ms hitches.
  try {
    Rec.obs = new PerformanceObserver(list => {
      for (const e of list.getEntries()) recPush(Rec.frames, { t: +(e.startTime - Rec.t0).toFixed(1), gap: +e.duration.toFixed(1), longtask: true, stroke: Rec.cur ? Rec.cur.id : null });
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
              stamps: 0, rays: 0, hits: 0, shared: 0, madeLayer: false, pen: false }, recSettings());
}
function recStrokeCount(what, n){ if (Rec.on && Rec.cur) Rec.cur[what] += (n === undefined ? 1 : n); }
function recStrokeFlag(what){ if (Rec.on && Rec.cur) Rec.cur[what] = true; }
function recStrokeEnd(){
  if (!Rec.on || !Rec.cur) return;
  Rec.cur.ms = +(recNow() - Rec.cur.t).toFixed(1);
  recPush(Rec.strokes, Rec.cur);
  Rec.cur = null;
}
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
    what: "WT Skin Studio session recording. Frame gaps and per-stroke counters, plus the moments " +
          "the user marked with F9. Written locally and never sent anywhere.",
    recordedAt: new Date().toISOString(),
    durationS: +(recNow() / 1000).toFixed(1),
    context: Rec.context,
    worstFrameMs: +Rec.worst.toFixed(1),
    droppedFrames: Rec.frames.length,
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
