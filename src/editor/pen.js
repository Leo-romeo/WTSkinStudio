/*==PEN==*/
"use strict";
// ---------- Between the pointer and the dab: pressure, smoothing and Flow (ROADMAP 4.50 (4) + 6.4) ----------
//
// Three things every comparable tool does with a painter's hand and this app did not. Both views
// took pointer events already, but `pressure` was never read, nothing steadied a stroke, and what
// the app called Opacity was two controls folded into one. Each lands here as arithmetic on plain
// objects — no DOM, no App, no canvas — so `tools/t95_pen.mjs` holds it under Node against exact
// answers, and the page half of that test drives the real stroke through it.
//
// PRESSURE is a pen's and nothing else's. The spec has a mouse report 0.5 while a button is down
// (0 otherwise) and touch report whatever the platform guesses, so reading either as pressure would
// paint every mouse stroke at half size. Anything that is not `pointerType === "pen"` is full
// pressure, and a mouse stroke is exactly the brush as set — byte for byte, which t95 asserts. A
// pen's pressure goes through a curve (a gamma: soft, linear or firm) and drives the dab's size, its
// flow, or both, per tool. Size is applied when the stamp is DRAWN, never baked into it: a per-dab
// size in `brushStamp._key` would rebuild the gradient canvas on every dab.
//
// SMOOTHING is a lazy-mouse string, measured in screen pixels because it is the hand it steadies:
// the brush does not move until the pointer is further than the string from it, and is then pulled
// straight after it until the string is taut. A wobble shorter than the string never reaches the
// sheet, and a corner comes out rounded by at most its length.
//
// FLOW is 6.4's design, taken as it was written: Opacity stays the ceiling on a whole stroke and
// Flow is what each dab lays down. Dabs still go into the one per-stroke buffer (§3.3), at
// `globalAlpha = flow` instead of 1, so where a stroke passes over itself they build up by the
// buffer's own source-over — and the buffer is still applied ONCE, at Opacity, so nothing about the
// compositing path or its cost moved. Build-up is the one branch 6.4 described: the buffer goes on
// at 1 and Opacity joins Flow on the dab, so a stroke keeps darkening past Opacity like a marker.
//
// This is also the seam 4.50 (10) builds brush dynamics on: a dab's size and flow are asked of
// `Pen.size` / `Pen.flow` at the pressure it is laid at, in one place, so jitter, scatter and
// angle are more outputs of the same question rather than a second walk. They are: `Pen.dab` is
// that one question, asked once per dab by `stampAt`, and it answers with where the dab lands, how
// big, how much it lays down and which way it faces — see "one dab's dynamics" below.
const Pen = {
  clamp(v){ return v < 0 ? 0 : v > 1 ? 1 : v; },

  // ---- what the pointer says ----
  pressure(e){ return e && e.pointerType === "pen" ? Pen.clamp(+e.pressure || 0) : 1; },
  // The samples one pointer move carries, in client pixels with their pressure. A pen reports at
  // 130–240 Hz and the browser dispatches one move per frame, keeping the rest as coalesced events;
  // without them a curve drawn fast is a polyline of 60 Hz chords. A pen's only: a mouse's would add
  // raycasts in 3-D for a fidelity nobody asked for. `getCoalescedEvents` is detected rather than
  // assumed — it is a secure-context API, and without it the move itself is the one sample.
  samples(e){
    const all = e.pointerType === "pen" && e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    return (all && all.length ? all : [e]).map(v => ({ x: v.clientX, y: v.clientY, p: Pen.pressure(v) }));
  },

  // ---- a stroke's input state ----
  // Set from the event that starts a stroke: the pressure its first dab is laid at, whether a pen is
  // driving it (the recorder logs that), and where the string's brush end starts — under the pointer.
  begin(st, e){
    st.pen = !!e && e.pointerType === "pen";
    st.p = Pen.pressure(e);
    st.string = { x: e.clientX, y: e.clientY };
    return st.pen;
  },
  // The brush positions one pointer move adds: every sample it carries, each pulled through the
  // string. Empty while the string is slack — the brush has not moved, so nothing is laid.
  follow(st, e, len){
    if (!st.string) st.string = { x: e.clientX, y: e.clientY };
    const out = [];
    for (const s of Pen.samples(e)) { const q = Pen.pull(st.string, s, len); if (q) out.push(q); }
    return out;
  },
  // The string itself. `st` is the brush end and moves; `s` is where the pointer is. Zero length is
  // off, and hands every sample through untouched.
  pull(st, s, len){
    if (!(len > 0)) { st.x = s.x; st.y = s.y; return s; }
    const dx = s.x - st.x, dy = s.y - st.y, d = Math.hypot(dx, dy);
    if (d <= len) return null;
    const k = (d - len) / d;
    st.x += dx * k; st.y += dy * k;
    return { x: st.x, y: st.y, p: s.p };
  },

  // ---- one dab, at the pressure it is laid at ----
  // The curve is a gamma: 1 is linear, below 1 soft (a light touch already lays most of it), above 1
  // firm. It maps 0 to 0 and 1 to 1, so full pressure — and therefore a mouse — is the brush as set.
  curve(p, gamma){ return Math.pow(Pen.clamp(p), gamma > 0 ? gamma : 1); },
  // Never under one texel: a feather-light touch still marks, and a zero-size draw would be a dab
  // that exists in the undo record and nowhere on the sheet.
  size(b, p){ return b.pSize ? Math.max(1, b.size * Pen.curve(p, b.curve)) : b.size; },
  flow(b, p){ return b.pFlow ? Pen.curve(p, b.curve) : 1; },

  // ---- one dab's dynamics (ROADMAP 4.50 (10)) ----
  // Everything a dab is, from the brush, the point the walk put it at (with its pressure) and the
  // way the stroke is heading there (radians on the sheet, or null where nothing says). With every
  // dynamic at 0 this is `Pen.size` and `Pen.flow` and nothing else — the same numbers, so a stroke
  // with no dynamics is the stroke it was, byte for byte (t131 compares them with ===).
  //   size jitter  shrinks a dab by up to that fraction of its size, never under one texel
  //   flow jitter  lays it at up to that fraction less. It is FLOW, not opacity, on purpose: the
  //                stroke buffer goes on once, at Opacity (§3.3), so what can vary per dab is the
  //                dab's own alpha — "opacity jitter" in Photoshop's words, the same thing here
  //   scatter      moves it off the stroke, anywhere in a disc of that many of its own sizes
  //   angle        the tip's own angle (degrees), plus the heading when it follows the stroke, plus
  //                up to ± angle jitter × 180°
  // The draws come from `rnd` in one fixed order, and only for the dynamics that are up — `rnd` is
  // the stroke's seeded stream for this channel, so a stroke is reproducible from its seed.
  // The walk is NOT moved by scatter: `stampAt` keeps the point the walk made as the channel's last
  // dab, or scatter would compound from dab to dab into a random walk off the stroke.
  dab(b, q, head, rnd){
    const size = Pen.size(b, q.p), flow = Pen.flow(b, q.p);
    const d = { x: q.x, y: q.y, size, flow, angle: (+b.angle || 0) * Math.PI / 180 };
    if (b.follow && head != null) d.angle += head;
    if (!rnd) return d;
    if (b.sizeJit > 0) d.size = Math.max(1, size * (1 - Pen.clamp(b.sizeJit) * rnd()));
    if (b.flowJit > 0) d.flow = flow * (1 - Pen.clamp(b.flowJit) * rnd());
    if (b.angleJit > 0) d.angle += (2 * rnd() - 1) * Math.PI * Pen.clamp(b.angleJit);
    if (b.scatter > 0) {
      const a = 2 * Math.PI * rnd(), s = b.scatter * size * Math.sqrt(rnd());   // uniform over the disc
      d.x += Math.cos(a) * s; d.y += Math.sin(a) * s;
    }
    return d;
  },
  // Whether any dynamic needs the random stream at all. A brush with none draws nothing from it.
  dynamic(b){ return b.sizeJit > 0 || b.flowJit > 0 || b.angleJit > 0 || b.scatter > 0; },
  // Which way the stroke is heading at a dab, for a tip that follows it: along the segment the walk
  // came down, or — for a dab laid on its own (a jump, the shape tool's Stamp along) — what the caller
  // knows (`ang`), or failing both the heading this channel last had. Null before anything says.
  // At a jump `stampAt` hands no last heading: it was a direction in the island the stroke left.
  heading(last, x, y, ang, prev){
    if (last && (x !== last.x || y !== last.y)) return Math.atan2(y - last.y, x - last.x);
    return ang != null ? ang : prev == null ? null : prev;
  },
  // Which way a step `d` on the model runs on the sheet, in the UV frame of the face it lands on —
  // what a 3-D stroke's first dab past a UV seam faces, where the walk on the sheet says nothing
  // (4.50 (10)'s review: it faced the way the stroke had run on the island it left). The face is
  // p0, p1, p2 with UVs t0, t1, t2 on a sheet W × H; `d` is taken into the face's own plane as
  // a·e1 + b·e2 and the same a and b carried to the UVs. Sheet y runs down and UV v up, as `stamp3d`
  // lays them. Null for a face with no area, or a step with nothing along it.
  faceHeading(d, p0, p1, p2, t0, t1, t2, W, H){
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const a11 = dot(e1, e1), a12 = dot(e1, e2), a22 = dot(e2, e2), det = a11 * a22 - a12 * a12;
    if (!(det > 1e-12 * a11 * a22)) return null;
    const b1 = dot(e1, d), b2 = dot(e2, d), al = (b1 * a22 - b2 * a12) / det, be = (a11 * b2 - a12 * b1) / det;
    const x = (al * (t1[0] - t0[0]) + be * (t2[0] - t0[0])) * W, y = -(al * (t1[1] - t0[1]) + be * (t2[1] - t0[1])) * H;
    return x || y ? Math.atan2(y, x) : null;
  },
  // The random stream: mulberry32, 32 bits of state, uniform on [0, 1). Seeded per stroke and per
  // stroke channel — the mirror, each turned copy — so a copy's jitter is its own rather than a
  // replay of the stroke's (weathering is not symmetric), and a test can fix a stroke's seed.
  rng(seed){
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  seed(){ return (Math.random() * 4294967296) >>> 0; },
  stream(st, ch){
    const r = st.rng || (st.rng = []);
    return r[ch] || (r[ch] = Pen.rng(((st.seed >>> 0) + Math.imul(ch + 1, 0x9E3779B9)) >>> 0));
  },

  // ---- where the dabs of one segment land ----
  // From the last dab `a` to the input point (x, y) at pressure p, each spaced by `spacing` of the
  // previous dab's OWN diameter: a light dab is small, and spacing it by the whole brush would dot
  // the stroke exactly where pressure had made it thin. Pressure runs linearly along the segment.
  // At constant pressure this is the loop it replaced number for number — the same step, the same
  // accumulation and `a.x + dx * d / dist` in the same order — which is what keeps a mouse stroke
  // byte-identical to what it was.
  walk(a, x, y, p, b, line){
    const dx = x - a.x, dy = y - a.y, dist = Math.hypot(dx, dy);
    const p0 = a.p == null ? p : a.p, sp = b.spacing || .35;
    const out = [];
    for (let d = Math.max(1, Pen.size(b, p0) * sp); d <= dist; ) {
      const pp = p0 + (p - p0) * d / dist;
      out.push({ x: a.x + dx * d / dist, y: a.y + dy * d / dist, p: pp });
      d += Math.max(1, Pen.size(b, pp) * sp);
    }
    // A move shorter than one spacing adds nothing — except at the end of a straight line, where
    // the endpoint itself is the point of the gesture.
    if (!out.length && line && dist > 0) out.push({ x, y, p });
    return out;
  },

  // ---- the 3-D walk: raycast sub-steps along the pointer's path ----
  // Coalesced samples make one pointer move a polyline, and the 3-D view walks it in raycast
  // sub-steps. They are spread by ARC LENGTH, so the budget is the one the chord had (a pen's extra
  // samples cost no extra rays) while the steps follow the curve the pen drew rather than cutting it.
  // One segment is the old `prev + (cur − prev) · t` in the same order: a mouse casts the rays it did.
  arc(path){
    let L = 0;
    for (let i = 1; i < path.length; i++) L += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    return L;
  },
  substeps(path, n){
    // A point with no pressure — a Shift+click line starts from where the last stroke ended, projected
    // through the camera, which knows nothing of pens — takes its neighbour's, and failing that full.
    const out = [], at = (a, b, t) => {
      const pb = b.p == null ? 1 : b.p, pa = a.p == null ? pb : a.p;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: pa + (pb - pa) * t };
    };
    if (path.length === 2) { for (let i = 1; i <= n; i++) out.push(at(path[0], path[1], i / n)); return out; }
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
    const L = cum[cum.length - 1];
    for (let i = 1, j = 1; i <= n; i++) {
      const s = L * i / n;
      while (j < path.length - 1 && cum[j] < s) j++;
      const seg = cum[j] - cum[j - 1];
      out.push(at(path[j - 1], path[j], seg > 0 ? Math.min(1, (s - cum[j - 1]) / seg) : 1));
    }
    return out;
  },

  // ---- Flow, and wash / build-up (6.4) ----
  // What a stroke lays down per dab (`dab`), how its buffer goes onto the layer (`apply`), and what a
  // dab with nothing to overlap lays down (`fill` — the shape tool's Fill, one dab that is the whole
  // path). Taken once when the stroke starts, so a stroke is one thing from its first dab to its last.
  //   wash (the default; Photoshop's, Procreate's "uniform"): dabs at Flow, the buffer at Opacity —
  //     a stroke builds where it crosses itself and never past Opacity.
  //   build-up (Krita's, Procreate's "glazed"): dabs at Flow × Opacity, the buffer at 1 — the
  //     ceiling is gone, and a stroke keeps darkening where it passes over itself.
  // A Fill lands at Opacity either way: Flow says how overlapping dabs build, and a fill is one dab.
  deposit(b){
    const op = Pen.clamp(b.opacity), fl = Pen.clamp(b.flow == null ? 1 : b.flow);
    return b.build ? { dab: fl * op, apply: 1, fill: op } : { dab: fl, apply: op, fill: 1 };
  },

  // ---- a copy that is not a copy ----
  // Which channel already laid this sub-step has its dab where a copy at (x, y) would lay another:
  // `laid` indexes `hits`, whose `px` / `py` are sheet texels, `r` is the dab's radius and `side`
  // the sheet's longer side. -1 when none has. A copy that lands there is the SAME dab — a part and
  // its twin painting from one set of texels — and laying it again doubles what Flow deposits; why,
  // and the measurement the tolerance rests on, are at stamp3d (editor/paint3d.js). The tolerance
  // is 1/1024 of the sheet (2 texels at 2048², 4 at 4096²), never under one texel, and never over
  // half the dab — so a small dab beside its copy stays two dabs.
  same(laid, hits, x, y, r, side){
    const tol = Math.min(r / 2, Math.max(1, side / 1024));
    for (let i = 0; i < laid.length; i++) {
      const h = hits[laid[i]];
      if (h && Math.hypot(x - h.px, y - h.py) <= tol) return laid[i];
    }
    return -1;
  },
};
/*==ENDPEN==*/
