/*==GRADIENT==*/
"use strict";
// ---------- Gradient fills (ROADMAP 4.44, fifth candidate) ----------
// A fade from the leading edge back, a two-tone split with a soft edge, a sun-fade from the top
// down: each is a gradient, and until now the app had none — a fill was one colour and a paint layer
// was pixels. A gradient here is a FILL content carrying a `grad` record beside its colour, not a
// content kind of its own, so everything that already accepts a fill (the Limit row, a mask, a
// blend-if band, a duplicate, the channel strip's conversions) accepts a gradient without having
// been told. The record:
//
//   { shape: "linear" | "radial"   space: "uv" | "model",
//         | "noise",               (4.50 (8): t from a noise field — editor/procedural.js — and a
//                                   `noise` sub-record; always along the model)
//     angle,                        uv: degrees, 0 = left→right, 90 = top→bottom (y down)
//     dir: [x, y, z],               model: a unit vector in the vehicle's own frame
//     from, to,                     0…1 — where t = 0 and t = 1 sit along the axis (below)
//     repeat,                       "clamp" | "repeat" | "reflect" — what happens past them
//     stops: [{ t, color, alpha }] } t 0…1, "#rrggbb", alpha 0…1 — straight, not premultiplied
//
// **`from` / `to` are fractions of an extent, never texels or metres.** In UV space the extent is the
// layer's rectangle limit (or the sheet) projected onto the angle; in model space it is the whole
// VEHICLE's bounding box projected onto `dir` — the vehicle's, not this sheet's parts', so a fade
// that spans the fuselage sheet and the wing sheet agrees where they meet, and so a `.wtstack`
// (4.44's seventh) carries a nose-to-tail fade onto a vehicle of another size and it is still nose
// to tail. Outside [from, to] the gradient clamps to its end stops.
//
// This section is the pure half — no DOM, no GL, no App — so `tools/t74_gradient.mjs` holds it under
// Node against answers that are exact: a stop reads its own colour, a midpoint reads the mean, the
// extent of a box along an axis is its side, and a texel's t is where its position says. `GradFill`
// below the marker is the app-facing half: the compositor's draw, the position bake it asks for and
// the whole-sheet render the channel strip and the thumbnail use.
const Gradient = {
  SHAPES: ["linear", "radial"],
  SPACES: ["uv", "model"],
  N: 256,                                     // LUT entries; the sheet has 8 bits a channel too
  // A fresh record: a fade from `color` to the same colour at alpha 0 — the most common gradient
  // on a skin is one colour fading out, so that is what a new one is.
  make(space, color){
    return { shape: "linear", space: space === "model" ? "model" : "uv", angle: 0, dir: [1, 0, 0], from: 0, to: 1, repeat: "clamp",
             stops: [{ t: 0, color: color || "#ffffff", alpha: 1 }, { t: 1, color: color || "#ffffff", alpha: 0 }] };
  },
  // Every edit replaces the record rather than writing into it, and a duplicate gets a copy of its
  // own — the same reason `LayerNode.clone` copies a content: two layers sharing one record would
  // move together the first time either was touched.
  clone(g){
    if (!g) return null;
    const out = { shape: g.shape, space: g.space, angle: +g.angle || 0, dir: (g.dir || [1, 0, 0]).slice(0, 3),
             from: g.from == null ? 0 : +g.from, to: g.to == null ? 1 : +g.to, repeat: Gradient.REPEATS.includes(g.repeat) ? g.repeat : "clamp",
             stops: (g.stops || []).map(s => ({ t: +s.t, color: Gradient.hexOf(s.color), alpha: s.alpha == null ? 1 : +s.alpha })) };
    // A noise (4.50 (8)) is this record with `shape: "noise"` and its own sub-record, copied as a
    // record of its own — editor/procedural.js reads it, and clamps it there, not here, so this
    // section still stands alone under Node.
    if (g.noise) out.noise = Object.assign({}, g.noise);
    return out;
  },
  // A stop's colour lands in a panel's markup as `value="${s.color}"`, and a gradient arrives from
  // project files, so anything but #rrggbb becomes grey here rather than markup (review 2026-10-10).
  hexOf(c){ const m = /^#?([0-9a-f]{6})$/i.exec(String(c || "")); return m ? "#" + m[1] : "#808080"; },
  sorted(stops){ return stops.slice().sort((a, b) => a.t - b.t); },
  rgb(hex){
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [128, 128, 128];
  },
  // The stops as a table of N RGBA entries over t ∈ [0, 1], interpolated straight (the colour and
  // the alpha each on their own line between stops, the way Photoshop and CSS do) and clamped to
  // the end stops beyond them. One stop is a flat fill; none is transparent black.
  lut(stops){
    const N = Gradient.N, out = new Uint8ClampedArray(N * 4);
    const S = Gradient.sorted(stops || []).map(s => ({ t: Math.max(0, Math.min(1, +s.t || 0)), c: Gradient.rgb(s.color), a: Math.max(0, Math.min(1, s.alpha == null ? 1 : +s.alpha)) }));
    if (!S.length) return out;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      let a = S[0], b = S[S.length - 1];
      for (let k = 0; k + 1 < S.length; k++) if (t >= S[k].t && t <= S[k + 1].t) { a = S[k]; b = S[k + 1]; break; }
      const span = b.t - a.t;
      const u = t <= a.t ? 0 : t >= b.t ? 1 : span > 0 ? (t - a.t) / span : 0;
      out[i*4]   = a.c[0] + (b.c[0] - a.c[0]) * u;
      out[i*4+1] = a.c[1] + (b.c[1] - a.c[1]) * u;
      out[i*4+2] = a.c[2] + (b.c[2] - a.c[2]) * u;
      out[i*4+3] = (a.a + (b.a - a.a) * u) * 255;
    }
    return out;
  },
  // ---- holographic presets (ROADMAP 4.56) ----
  // Named stop sets for the iridescent look the owner painted by hand on the Ho 229's wing. The game
  // has no view-dependent shader for a skin, so a holo is baked colour, and these are its usual
  // palettes: the spectrum, the pastel shift of a foil sticker, the dark bands of oil on water, a
  // pearl's near-white, and the straw-to-blue of heat-tinted titanium round an exhaust. Every stop
  // here is opaque; a preset replaces a gradient's COLOURS, and the panel gives each stop the alpha
  // the gradient had at its place (`holoOver`), so a fade stays a fade. The brush's colour cycle
  // (`Pen.ink`) runs along the same sets, through `holoLut`.
  HOLO: [
    { id: "rainbow", name: "Rainbow", stops: [[0, "#ff0000"], [.17, "#ff8000"], [.33, "#ffff00"], [.5, "#00ff00"], [.67, "#00c0ff"], [.83, "#4000ff"], [1, "#ff00c0"]] },
    { id: "foil",    name: "Holographic foil", stops: [[0, "#ff9ad5"], [.2, "#c7a6ff"], [.4, "#8fd3ff"], [.6, "#9effc5"], [.8, "#fff59a"], [1, "#ff9ad5"]] },
    { id: "oil",     name: "Oil slick", stops: [[0, "#1b1446"], [.2, "#5a1e78"], [.4, "#1f6f8b"], [.6, "#2f9e5a"], [.8, "#c9a227"], [1, "#8a1e4b"]] },
    { id: "pearl",   name: "Pearl", stops: [[0, "#f4eef0"], [.25, "#e8f0ff"], [.5, "#f2ffef"], [.75, "#fff3e6"], [1, "#f6eaf6"]] },
    { id: "heat",    name: "Heat tint", stops: [[0, "#c8b07a"], [.2, "#b07a3a"], [.4, "#7a3e8a"], [.6, "#3a5ac8"], [.8, "#5ab0d0"], [1, "#c8d8a0"]] },
  ],
  // A preset's stops as records a gradient carries — a fresh copy each time — or null for a name no
  // preset has.
  holo(id){
    const P = Gradient.HOLO.find(p => p.id === id);
    return P ? P.stops.map(([t, color]) => ({ t, color, alpha: 1 })) : null;
  },
  // A preset's colours over an existing gradient's stops: each new stop takes the alpha `old` has
  // where it sits, so picking a holo for a colour fading to nothing keeps the fade. Null for a
  // name no preset has.
  holoOver(id, old){
    const S = Gradient.holo(id);
    if (!S) return null;
    const lut = Gradient.lut(old || []), N = Gradient.N;
    if (old && old.length) for (const s of S) s.alpha = lut[Math.round(s.t * (N - 1)) * 4 + 3] / 255;
    return S;
  },
  // …and as a table, made once per preset: a stroke asks for it on every dab.
  _holoLut: new Map(),
  holoLut(id){
    if (!Gradient._holoLut.has(id)) { const s = Gradient.holo(id); Gradient._holoLut.set(id, s ? Gradient.lut(s) : null); }
    return Gradient._holoLut.get(id);
  },
  // ---- model space ----
  // Where a box reaches along a direction: the least and greatest projection of its eight corners.
  // Exact for the axis directions, a little generous on a diagonal — a predictable extent, which is
  // what "from 30 % to 60 % of the way back" needs to mean the same thing tomorrow.
  extent(bb, dir){
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < 8; k++) {
      const x = k & 1 ? bb.x1 : bb.x0, y = k & 2 ? bb.y1 : bb.y0, z = k & 4 ? bb.z1 : bb.z0;
      const d = x * dir[0] + y * dir[1] + z * dir[2];
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    return [lo, hi];
  },
  // The two projections t = 0 and t = 1 sit at. `to` below `from` runs the gradient backwards, and
  // the two equal is a hard edge at that point rather than a division by zero.
  band(bb, dir, from, to){
    const [lo, hi] = Gradient.extent(bb, dir);
    const t0 = lo + (hi - lo) * from, t1 = lo + (hi - lo) * to;
    return { t0, t1: t1 === t0 ? t0 + 1e-9 : t1 };
  },
  unit(v){
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  },
  // A direction as two angles a slider can hold, and back: yaw round the vertical, pitch above it.
  dirOf(yaw, pitch){
    const a = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
    return [Math.cos(p) * Math.cos(a), Math.sin(p), Math.cos(p) * Math.sin(a)];
  },
  anglesOf(dir){
    const d = Gradient.unit(dir);
    return { yaw: Math.round(Math.atan2(d[2], d[0]) * 180 / Math.PI), pitch: Math.round(Math.asin(Math.max(-1, Math.min(1, d[1]))) * 180 / Math.PI) };
  },
  // The six axis presets, in the vehicle's own words. A game model has its nose along +x, up along
  // +y and its port side at −z (measured over the roster — view3d/scene.js, ArmBuild.hardpoints);
  // an OBJ whose left-right axis the loader found to be x has its nose along z instead, which is
  // what `App.autoAxis` records and what these follow.
  presets(sideAxis){
    const fwd = sideAxis === "x" ? [0, 0, 1] : [1, 0, 0];
    const side = sideAxis === "x" ? [1, 0, 0] : [0, 0, 1];
    const neg = v => [-v[0], -v[1], -v[2]];
    return [
      { label: "nose → tail", dir: neg(fwd) }, { label: "tail → nose", dir: fwd },
      { label: "top → bottom", dir: [0, -1, 0] }, { label: "bottom → top", dir: [0, 1, 0] },
      { label: "port → starboard", dir: side }, { label: "starboard → port", dir: neg(side) },
    ];
  },
  // ---- the two evaluators, one writer ----
  // Both spaces come down to "a t per texel, then the stops", and they share the last step so a
  // stop means one thing everywhere. `repeat` is what happens past the ends: `clamp` holds the end
  // stops (a fade), `repeat` starts over (stripes), `reflect` runs back (a fade out from a centre
  // line to both sides — "port → starboard from 50 %, reflected" is the fuselage-to-wingtip fade).
  // The stops are interpolated per texel at float precision and a 4×4 ordered dither is added to
  // the VALUE before it is rounded to a byte, in absolute sheet texels so a region and the whole
  // sheet agree. Not to a table index: the table is already bytes, so a dither there cannot break
  // the bands of the ramp a skin fade actually is — #404040 to #505050 across a wing is sixteen
  // values over two thousand texels, a staircase of 125-texel steps whichever entry is picked.
  REPEATS: ["clamp", "repeat", "reflect"],
  BAYER: [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5],
  // The writer for one region: `put(t, x, y)` takes t and the texel's absolute sheet coordinates.
  writer(g, out){
    const S = Gradient.sorted(g.stops || []).map(s => ({ t: Math.max(0, Math.min(1, +s.t || 0)), c: Gradient.rgb(s.color), a: 255 * Math.max(0, Math.min(1, s.alpha == null ? 1 : +s.alpha)) }));
    const n = S.length, B = Gradient.BAYER;
    const mode = g.repeat === "repeat" ? 1 : g.repeat === "reflect" ? 2 : 0;
    let o = 0;
    return {
      skip(){ out[o+3] = 0; o += 4; },
      put(t, x, y){
        if (!n) { out[o+3] = 0; o += 4; return; }
        if (mode === 1) t -= Math.floor(t);
        else if (mode === 2) { t -= 2 * Math.floor(t / 2); if (t > 1) t = 2 - t; }
        let a = S[0], b = S[n - 1], u = 0;
        if (t <= a.t) b = a;
        else if (t >= b.t) a = b;
        else {
          let k = 0;
          while (k + 1 < n && t > S[k + 1].t) k++;
          a = S[k]; b = S[k + 1];
          u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
        }
        const d = (B[((y & 3) << 2) | (x & 3)] + .5) / 16 - .5;  // −15/32 … +15/32: a whole value stays itself, a fraction rounds up as often as down
        out[o]   = a.c[0] + (b.c[0] - a.c[0]) * u + d;            // Uint8ClampedArray rounds and clamps
        out[o+1] = a.c[1] + (b.c[1] - a.c[1]) * u + d;
        out[o+2] = a.c[2] + (b.c[2] - a.c[2]) * u + d;
        out[o+3] = a.a + (b.a - a.a) * u + d;
        o += 4;
      },
    };
  },
  // One region of the sheet, from a position bake. `P` is `{ w, h, pos, has, bb }` — `pos` three
  // Uint16 per texel, each axis 0…65535 across the box `bb`; `has` 1 where a texel holds a position
  // (an island, or the padded gutter beside one). The region is `tw × th` texels at `(sx, sy)` of a
  // `W × H` sheet, sampled nearest at the bake's own size; `out` is its RGBA, straight alpha, and a
  // texel with no position is left transparent. `ext`, when given, is the box `from` / `to` are
  // fractions of (a layer limited to parts uses theirs); the bake's own box otherwise.
  evalModel(P, g, W, H, sx, sy, tw, th, out, ext){
    const dir = Gradient.unit(g.dir || [1, 0, 0]);
    const { t0, t1 } = Gradient.band(ext || P.bb, dir, g.from == null ? 0 : g.from, g.to == null ? 1 : g.to);
    const kx = P.w / W, ky = P.h / H;
    // p = bb0 + u16 / 65535 · (bb1 − bb0), so dot(p, dir) = c0 + u16x·ax + u16y·ay + u16z·az
    const ax = (P.bb.x1 - P.bb.x0) / 65535 * dir[0], ay = (P.bb.y1 - P.bb.y0) / 65535 * dir[1], az = (P.bb.z1 - P.bb.z0) / 65535 * dir[2];
    const c0 = P.bb.x0 * dir[0] + P.bb.y0 * dir[1] + P.bb.z0 * dir[2];
    const scale = 1 / (t1 - t0);
    const pos = P.pos, has = P.has, w = Gradient.writer(g, out);
    for (let y = 0; y < th; y++) {
      const by = Math.min(P.h - 1, ((sy + y) * ky) | 0) * P.w;
      for (let x = 0; x < tw; x++) {
        const i = by + Math.min(P.w - 1, ((sx + x) * kx) | 0);
        if (!has[i]) { w.skip(); continue; }
        w.put((c0 + pos[i*3] * ax + pos[i*3+1] * ay + pos[i*3+2] * az - t0) * scale, sx + x, sy + y);
      }
    }
    return out;
  },
  // ---- UV space ----
  // The axis a linear gradient runs along, in sheet texels: through the centre of the rectangle
  // `r` (the layer's limit, or the sheet), at `angle`, with t = 0 and t = 1 at `from` and `to` of
  // the rectangle's own reach along that angle — so 0…1 spans the rectangle exactly whatever the
  // angle, and a diagonal does not run off its corners early. A radial one is centred the same way
  // with `from` / `to` as fractions of the corner reach, so 100 % touches the corners. `from` =
  // `to` is a hard edge.
  uvAxis(g, r){
    const a = (+g.angle || 0) * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const from = g.from == null ? 0 : +g.from;
    let to = g.to == null ? 1 : +g.to;
    if (to === from) to += 1e-6;
    if (g.shape === "radial") { const e = Math.hypot(r.w, r.h) / 2; return { cx, cy, r0: Math.max(0, from * e), r1: Math.max(0, to * e) }; }
    const e = Math.abs(dx) * r.w / 2 + Math.abs(dy) * r.h / 2;
    return { x0: cx + (2 * from - 1) * e * dx, y0: cy + (2 * from - 1) * e * dy,
             x1: cx + (2 * to - 1) * e * dx, y1: cy + (2 * to - 1) * e * dy };
  },
  // The same region evaluation for UV space, through the same table — so the two spaces agree on
  // what a stop means (a canvas gradient would interpolate its alpha premultiplied, and a fade to
  // transparent would darken mid-way in one space and not the other). Linear is affine in the
  // texel, so it steps along a row; radial takes a square root per texel. Texel centres.
  evalUV(g, r, W, H, sx, sy, tw, th, out){
    const ax = Gradient.uvAxis(g, r), w = Gradient.writer(g, out);
    if (g.shape === "radial") {
      const scale = 1 / Math.max(1e-9, ax.r1 - ax.r0);
      for (let y = 0; y < th; y++) {
        const dy = sy + y + .5 - ax.cy;
        for (let x = 0; x < tw; x++) { const dx = sx + x + .5 - ax.cx; w.put((Math.sqrt(dx * dx + dy * dy) - ax.r0) * scale, sx + x, sy + y); }
      }
      return out;
    }
    const vx = ax.x1 - ax.x0, vy = ax.y1 - ax.y0, l2 = Math.max(1e-18, vx * vx + vy * vy);
    const kx = vx / l2, ky = vy / l2;
    for (let y = 0; y < th; y++) {
      const t0 = (sx + .5 - ax.x0) * kx + (sy + y + .5 - ax.y0) * ky;
      for (let x = 0; x < tw; x++) w.put(t0 + x * kx, sx + x, sy + y);
    }
    return out;
  },
};
/*==ENDGRADIENT==*/
// ---- the app-facing half ----
// What the compositor calls for a fill that carries a gradient, and what the channel strip calls
// for the same pixels whole. The gradient is EVALUATED ONCE per record into a sheet cached on the
// content (`c._gradSheet`, keyed by the record, the bake, the sheet size and the layer's limit)
// and every region is a blit of that sheet, exactly as a paint content's canvas is — measured
// before this was so: the per-texel loop over a whole 4096² sheet is ~250 ms, and a whole-sheet
// composite is what every opacity tick, blend change and reorder on the slot schedules, so a
// gradient in the stack made every slider on the slot stall (the design review of 2026-09-21).
// The sheet is evaluated at the bake's side at most (`SIDE`) and scaled up by the blit: a position
// varies smoothly across an island, and a bilinear upscale of a smooth ramp reads better than the
// nearest-texel sample of a 4096² loop would, at a quarter of the cost.
//
// Along the model the sheet reads the slot's POSITION BAKE (`Bake.position`), which is asked for
// once and lands asynchronously — the walk is synchronous and the bake is a GPU pass with a
// progress bar. So the first composite of a sheet with no bake yet draws nothing for the gradient,
// asks, and the sheet is re-composited when the bake arrives; export waits for every bake it needs
// (`ensure`) before it reads a sheet. Requests are serialised, one bake at a time on the one GL
// context, and wait for the progress bar to be free rather than taking it from whatever holds it.
// A cancel is a cancel — nothing is reported and the next composite asks again; a real failure is
// reported once and not retried until the key moves, so a sheet cannot loop on it.
//
// **Since 4.50 (7) and (8) this is the engine for every fill that is evaluated rather than flat**:
// a gradient, a NOISE (a gradient record with `shape: "noise"`, editor/procedural.js) and a
// PATTERN (`c.pat` beside the fill's colour, with its tile image in `c.patImg`). They share
// everything above — the one position-bake queue, the latches, `ensure`, `prune`, the per-content
// sheet cache, the mask a fill lends — which is what "build the model-space machinery once" meant.
// What differs is WHERE the sheet is evaluated:
//   * a gradient, here, synchronously (above; ~60 ms at the 2048² cap);
//   * a pattern on the sheet, here, as a canvas pattern (`uvPatSheet`; the GPU fills it);
//   * a noise, or a pattern along the model, in the FILL POOL (`pool`, `run`) — measured
//     2026-09-26 under Node: five octaves of Perlin over a 2048² sheet 60 % covered is 479 ms on
//     one thread, one octave of cells 494 ms, two 995 ms; §3's 200 ms bar is broken several times
//     over, so they are evaluated in bands across the workers, off this thread. While one runs, the
//     layer keeps showing the sheet it had (a slider dragged over noise shows the last result, not
//     a blank), and when it lands the slot is re-composited — which asks again if the record moved
//     meanwhile. One evaluation per content in flight, so a drag cannot queue forty of them.
const GradFill = {
  SIDE: 2048,
  _q: Promise.resolve(),                 // the bake queue: at most one position bake in flight
  // One bake at a time, and the queue NEVER holds a rejection: a `then` chained onto a rejected
  // promise skips its callback — with its `finally` — so one cancelled export would have left
  // `_posPending` true on the slot and the queue refusing everything after it, for the session.
  // The caller gets the bake's own promise, rejection and all; the queue keeps a swallowed tail.
  enqueue(slot){
    const p = GradFill._q.then(() => Bake.run(slot, "pos"));
    GradFill._q = p.catch(() => {});
    return p;
  },
  // The rectangle a UV gradient spans, in the CHANNEL sheet's texels: the layer's Limit rectangle
  // (stored in albedo texels — editor/scope.js) or the whole sheet.
  rect(cx, L){
    const r = L ? Scope.rect(L) : null;
    if (!r) return { x: 0, y: 0, w: cx.W, h: cx.H };
    const k = cx.slot && cx.slot.composite ? cx.W / cx.slot.composite.width : 1;
    return { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k };
  },
  // The box `from` / `to` are fractions of, along the model: the layer's PARTS' box when it is
  // limited to parts, the vehicle's otherwise. "The left wing, nose to tail, from 0 to 25 %" is
  // then the leading-edge fade in three moves; and a linked family names the same parts on every
  // sheet, so the siblings still agree where they meet.
  extentBox(L){
    const parts = L ? Scope.parts(L) : null;
    if (!parts || !App.geomData) return null;
    const set = new Set(parts);
    let bb = null;
    for (const gd of App.geomData) {
      if (gd.weapon || !gd.position || !set.has(gd.name)) continue;
      const b = gdBounds(gd);
      bb = bb ? { x0: Math.min(bb.x0, b.x0), y0: Math.min(bb.y0, b.y0), z0: Math.min(bb.z0, b.z0),
                  x1: Math.max(bb.x1, b.x1), y1: Math.max(bb.y1, b.y1), z1: Math.max(bb.z1, b.z1) } : Object.assign({}, b);
    }
    return bb;
  },
  // The position bake this sheet's gradients read: the current one, or — while the body on show
  // does not use this sheet at all (the cockpit is up, and this is the airframe's sheet) — the
  // last one, since nothing of it is visible and a re-bake against the wrong body would only fail.
  bake(slot){
    const b = Bake.cached(slot, "pos");
    if (b) return b;
    const old = slot._bake && slot._bake.pos;
    if (old && (!App.geomData || !Bake.groups(slot).length)) return old;
    GradFill.request(slot);
    return null;
  },
  // Can this sheet be baked at all right now: a model, and a part of it on this sheet.
  bakeable(slot){ return !!(slot && App.geomData && Bake.groups(slot).length); },
  request(slot){
    if (!slot || slot._posPending || !GradFill.bakeable(slot)) return;   // nothing to read a position from — draw nothing, say nothing
    const key = Bake.key(slot, "pos");
    if (slot._posFail === key || slot._posDeclined === key) return;
    slot._posPending = true;
    // Deferred out of the composite that asked, queued behind any bake already running, and held
    // until the progress bar is free: `Bake.run` opens the bar and it does not nest.
    GradFill._q = GradFill._q.then(async () => {
      let landed = false;
      try {
        while (Prog.active) await new Promise(r => setTimeout(r, 120));
        await Bake.run(slot, "pos");
        landed = true;
      } catch (err) {
        // A cancel is remembered on the slot, not reported, and not asked again by the very next
        // composite — which is what the layer's own re-draw would have done, bringing the bar
        // straight back. Editing the gradient, or picking "along the model" again, asks again.
        if (err instanceof Cancelled) { slot._posDeclined = key; setStatus("A fill along the model (a gradient, noise or pattern) is not placed — the bake was cancelled. Change it, or choose “along the model” again, to place it", "err"); }
        else { slot._posFail = key; reportFailure("Placing a fill along the model on “" + slot.id + "”", err, "grad-pos|" + slot.id); }
      } finally {
        slot._posPending = false;
        if (landed) { scheduleComposite(slot); scheduleChannels(slot); }
      }
    });
  },
  // The user has touched a gradient on these slots: a declined bake may be asked for again.
  retry(slots){ for (const s of slots) if (s) delete s._posDeclined; },
  // Every bake an export will read, before it reads any of them. Nothing to do on the ordinary
  // path — a gradient's sheet has been on screen, so its bake is cached — and the one case it
  // covers is an export fired before the first composite's bake has landed. A sheet that gets its
  // bake here is re-composited before the export's own flush reads it.
  async ensure(){
    for (const s of App.slots.values()) {
      if (!s.layers || !GradFill.needsBake(s) || Bake.cached(s, "pos") || !GradFill.bakeable(s)) continue;
      await GradFill.enqueue(s);
      scheduleComposite(s); scheduleChannels(s);
    }
    // ...and every noise and every pattern along the model evaluated for the record it holds NOW,
    // hidden layers too (a hidden noise is a mask something else reads), so an export fired in
    // the middle of a slider drag waits for the last value rather than shipping the one before
    // A pattern along the model that another layer's mask reads is evaluated twice — as itself and
    // as the mask (`maskContent`) — and the export waits for both.
    for (const s of App.slots.values()) {
      if (!s.layers) continue;
      let any = false;
      const lent = GradFill.lentBy(s);
      for (const L of layerLeaves(s.layers)) for (const ch of LayerNode.channelsOf(L)) {
        const c = L.chans[ch];
        if (!GradFill.isAsync(c)) continue;
        await GradFill.settle(s, c, L);
        if (c.pat && lent.has(L)) await GradFill.settle(s, GradFill.maskContent(c), L);
        any = true;
      }
      if (any) { scheduleComposite(s); scheduleChannels(s); }
    }
  },
  needsBake(slot){
    return layerLeaves(slot.layers).some(L => LayerNode.channelsOf(L).some(ch => GradFill.isModel(L.chans[ch])));
  },
  // Which fills read the position bake: a gradient along the model, every noise, and a pattern
  // along the model. And which of those are evaluated in the pool rather than on this thread.
  isModel(c){ return !!(c && c.kind === "fill" && ((c.grad && (c.grad.space === "model" || c.grad.shape === "noise")) || (c.pat && c.pat.space === "model"))); },
  isAsync(c){ return !!(c && c.kind === "fill" && ((c.grad && c.grad.shape === "noise") || (c.pat && c.pat.space === "model"))); },
  // The bake is 24 MB a sheet: kept while anything on the sheet reads it, dropped on the first
  // whole composite after the last such layer goes (compositor.js calls this there).
  prune(slot){
    GradFill.pruneTiles();
    if (slot && slot.layers) GradFill.pruneMasks(slot);
    if (!slot || !slot._bake || !slot._bake.pos || GradFill.needsBake(slot)) return;
    delete slot._bake.pos;
  },
  // ...and the tile every worker of the fill pool keeps (`pool`, 5.6 MB each at 1024², eight
  // workers) once no pattern along the model is left on any sheet: the workers go, and the next
  // evaluation starts new ones. Only while the pool is idle — `dispose` does not settle a job in
  // flight, and one that never settles would leave its content waiting for ever.
  pruneTiles(){
    const P = GradFill._pool;
    if (!P || !GradFill._tileIn || P.pending.size || P.queue.length) return;
    for (const s of App.slots.values())
      if (s.layers && layerLeaves(s.layers).some(L => LayerNode.channelsOf(L).some(ch => { const c = L.chans[ch]; return c.pat && c.pat.space === "model"; }))) return;
    P.dispose();
    GradFill._tileIn = 0;
  },
  // The layers of this slot whose pixels another layer's mask reads (`LayerNode.maskFrom`).
  lentBy(slot){ return new Set(layerNodes(slot.layers).map(n => LayerNode.maskFrom(slot, n)).filter(Boolean)); },
  // ...and the mask a pattern ON THE SHEET lends (`maskContent`), once no mask reads it: its sheet
  // is the albedo's size — 64 MB at 4096², 256 at 8192² — and would otherwise live as long as the
  // pattern does, lent or not. Linked again, it is drawn again, synchronously and the same. One
  // along the model is kept: it is at most the bake's 2048², and an undone unlink would otherwise
  // wait for the pool, the masked layer showing unmasked meanwhile. A content that is no longer a
  // pattern drops it whatever reads it.
  pruneMasks(slot){
    let lent = null;
    for (const L of layerLeaves(slot.layers)) for (const ch of LayerNode.channelsOf(L)) {
      const c = L.chans[ch], m = c && c._maskC;
      if (!m || (m._proc && m._proc.busy)) continue;
      if (c.pat && (c.pat.space === "model" || (lent || (lent = GradFill.lentBy(slot))).has(L))) continue;
      delete c._maskC;
    }
  },
  // The evaluated sheet for this content on this channel sheet — cached on the content under a key
  // of everything it depends on, so a region blit is all a composite costs and a slider tick on an
  // unrelated layer costs nothing here.
  sheet(cx, c, L){
    if (c.pat) return c.pat.space === "model" ? GradFill.asyncSheet(cx.slot, c, L) : GradFill.uvPatSheet(cx.slot, c);
    if (c.grad.shape === "noise") return GradFill.asyncSheet(cx.slot, c, L);
    const g = c.grad;
    const model = g.space === "model";
    const P = model ? GradFill.bake(cx.slot) : null;
    if (model && !P) return null;
    // The last bake, while the body on show does not use this sheet: whatever sheet was built from
    // it stands — nothing of it is visible, and the parts box would be read off the wrong body.
    if (model && P !== Bake.cached(cx.slot, "pos") && c._gradSheet) return c._gradSheet;
    const r = GradFill.rect(cx, L), ext = model ? GradFill.extentBox(L) : null;
    // the bake's serial, not only its key: a re-bake after a vehicle change can carry the same key
    const key = JSON.stringify(g) + "|" + (P ? P.key + "#" + P.ser + "|" + P.w + "x" + P.h : "uv") + "|" + cx.W + "x" + cx.H + "|" +
                [r.x, r.y, r.w, r.h].join(",") + "|" + (ext ? [ext.x0, ext.y0, ext.z0, ext.x1, ext.y1, ext.z1].join(",") : "");
    if (c._gradSheet && c._gradKey === key) return c._gradSheet;
    const k = Math.min(1, GradFill.SIDE / Math.max(cx.W, cx.H));
    const ew = Math.max(1, Math.round(cx.W * k)), eh = Math.max(1, Math.round(cx.H * k));
    const out = mkCanvas(ew, eh), og = ctx2d(out);
    const img = og.createImageData(ew, eh);
    if (model) Gradient.evalModel(P, g, ew, eh, 0, 0, ew, eh, img.data, ext);
    else Gradient.evalUV(g, { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k }, ew, eh, 0, 0, ew, eh, img.data);
    og.putImageData(img, 0, 0);
    c._gradSheet = out; c._gradKey = key;
    return out;
  },
  // ---- the pool's fills: noise, and a pattern along the model (4.50 (7) and (8)) ----
  // The sheet on show while the current record is evaluated: the last one landed, or nothing.
  asyncSheet(slot, c, L){
    const job = GradFill.job(slot, c, L);
    if (!job) return null;                               // no bake yet (asked for) or no image: draws nothing
    if (c._gradKey !== job.key) GradFill.kick(slot, c, L, job);
    return c._gradSheet || null;
  },
  // What evaluating this content means right now — the bake, a copy of the record, and a key of
  // everything the result depends on — or null when it cannot be evaluated yet. The sheet is
  // evaluated at the BAKE's size whatever channel asks: the same content lent as a mask at the
  // albedo's size and drawn on a half-size surface sheet then has one key, where two sizes would
  // alternate and each landing would ask for the other, for ever.
  job(slot, c, L){
    const P = GradFill.bake(slot);
    if (!P) return null;
    const at = "|" + P.key + "#" + P.ser + "|" + P.w + "x" + P.h;
    if (c.grad) { const rec = Gradient.clone(c.grad); return { kind: "noise", P, rec, key: "noise|" + JSON.stringify(rec) + at }; }
    const img = c.patImg;
    if (!img || !img.width || !P.nrm) return null;
    const rec = Procedural.patClone(c.pat);
    return { kind: "tri", P, rec, img, key: "tri|" + JSON.stringify(rec) + "|" + GradFill.imgId(img) + at };
  },
  // Start `job` unless this content already has an evaluation running — then that one finishes,
  // the composite it schedules asks again, and the record as it is THEN is the next one done.
  // A record that failed or was cancelled is latched, so that composite does not ask for it again;
  // the latch lifts when any later record of the content lands, so going back to it tries again.
  kick(slot, c, L, job){
    const st = c._proc || (c._proc = {});
    if (st.busy || st.fail === job.key) return st.p || null;
    st.busy = job.key;
    const what = LayerNode.wordFor(c) + (L ? " on “" + L.name + "”" : "");
    const bar = GradFill.barFor(st, "Working out " + what + "…");
    st.p = GradFill.run(job, bar).then(cv => {
      c._gradSheet = cv; c._gradKey = job.key; st.fail = st.why = null;
      if (L) { if (L._thumb) L._thumbRev = -1; else L._thumb = null; }
    }, err => {
      st.fail = job.key;
      if (err instanceof Cancelled) {
        st.why = "cancelled";
        setStatus("Stopped working out " + what + " — it shows what it showed before. Change it to work it out again", "err");
        return;
      }
      st.why = "failed";
      reportFailure("Evaluating " + what, err, "fill-eval|" + slot.id);
    }).finally(() => {
      bar.end();
      st.busy = null; st.p = null;
      scheduleComposite(slot); scheduleChannels(slot);
    });
    return st.p;
  },
  // The progress bar an evaluation shows (§3.5). Measured 2026-09-26 in headless Chrome over a
  // 2048² bake 60 % covered, with the pool at 8 workers: Perlin at four octaves 138 ms, at eight
  // 208, cells at one 125 and at eight 647, a tri-planar 1024² tile 182 — and a pool of three, on
  // a four-thread machine, is about 2.7 times slower. So an evaluation that is still running at
  // 200 ms takes the bar, if nothing else holds it: determinate, by the bands that have landed,
  // and cancellable. The bar belongs to the CONTENT (`st`) rather than to one evaluation, and is
  // let go 250 ms after one lands — a slider dragged over a slow noise starts the next evaluation
  // inside that window, so it shows one steady bar instead of one flashing per value.
  // The bands that land before the bar comes up are counted too (`b.frac`): the first version
  // dropped them, so a bar that opened at 200 ms sat indeterminate until the next band landed —
  // which under load was after t94's fixed 450 ms look (review of 4.50 (7), 2026-09-26).
  barFor(st, label){
    const b = st.bar || (st.bar = { gen: -1, open: 0, close: 0, frac: -1 });
    const mine = () => Prog.active && Prog.gen === b.gen;
    clearTimeout(b.close); b.close = 0;
    b.frac = -1;
    if (mine() && !Prog.cancelled) progress(label, 0);
    else b.open = setTimeout(() => { b.open = 0; if (!Prog.active) { progBegin(label, true, b.frac); b.gen = Prog.gen; } }, 200);
    return {
      tick: (done, total) => { b.frac = done / total; if (mine()) progress(null, b.frac); },
      cancelled: () => mine() && Prog.cancelled,
      end: () => {
        clearTimeout(b.open); b.open = 0;
        if (!mine()) return;
        if (Prog.cancelled) { progEnd(); return; }
        b.close = setTimeout(() => { b.close = 0; if (mine()) progEnd(); }, 250);
      },
    };
  },
  _pool: null,
  // The pool's workers each keep the LAST tile they were handed (`TILE`, below): a band for a
  // pattern carries the tile's mip chain only where the worker may not hold it, and a worker that
  // turns out not to answers `{ need }` and gets the band again with it. Measured 2026-09-26 on a
  // 1024² tile over a 2048² bake: a copy of the chain in every one of 16 bands held this thread
  // 38 ms at the start of each evaluation — 130 MB of copying in one task — which is a hitch on
  // every tick of a slider dragged over a pattern.
  _tileIn: 0,                            // the tile the pool's workers were last handed, as `imgId`
  pool(){
    return GradFill._pool || (GradFill._pool = makeWorkerPool({ name: "fill", sections: ["GRADIENT", "PROCEDURAL"], ops: `var TILE = null;
var WT_OPS = {
  fill: function(a){
    var M = null;
    if (a.kind === "tri") {
      if (a.M) TILE = { id: a.tile, M: Procedural.unpack(a.M) };
      else if (!TILE || TILE.id !== a.tile) return { need: 1 };
      M = TILE.M;
    }
    var P = { w: a.w, h: a.h, row0: a.row0, rows: a.rows, bb: a.bb, pos: new Uint16Array(a.pos), has: new Uint8Array(a.has), nrm: a.nrm ? new Uint8Array(a.nrm) : null };
    var out = new Uint8ClampedArray(a.w * a.th * 4);
    if (a.kind === "noise") Procedural.evalNoise(P, a.rec, a.w, a.h, 0, a.y0, a.w, a.th, out);
    else Procedural.evalTri(P, a.rec, M, a.w, a.h, 0, a.y0, a.w, a.th, out);
    return { __t: 1, result: out.buffer, transfer: [out.buffer] };
  },
  mips: function(a){
    var M = Procedural.pack(Procedural.mips(new Uint8ClampedArray(a.rgba), a.w, a.h));
    return { __t: 1, result: M, transfer: [M.buf] };
  }
};` }));
  },
  // Band `b` of `n`: only ITS rows of the bake — plus the row above and the row below, which a
  // pattern's footprint reads (`Procedural.footprint`) — as copies it owns and can have transferred,
  // so nothing this thread still holds is given away; and, when `M` is passed, a copy of the tile's
  // packed mip chain for the worker to keep. `row0` is the first row the band HOLDS, `y0` the first
  // it writes.
  band(job, n, b, M){
    const P = job.P, y0 = Math.floor(P.h * b / n), y1 = Math.floor(P.h * (b + 1) / n);
    const h0 = Math.max(0, y0 - 1), r1 = Math.min(P.h, y1 + 1);
    const pos = P.pos.slice(h0 * P.w * 3, r1 * P.w * 3), has = P.has.slice(h0 * P.w, r1 * P.w);
    const nrm = job.kind === "tri" ? P.nrm.slice(h0 * P.w * 3, r1 * P.w * 3) : null;
    const mb = M ? { buf: M.buf.slice(0), levels: M.levels, aspect: M.aspect } : null;
    const transfer = [pos.buffer, has.buffer];
    if (nrm) transfer.push(nrm.buffer);
    if (mb) transfer.push(mb.buf);
    return { op: "fill", transfer, args: { kind: job.kind, rec: job.rec, tile: job.tile || 0, M: mb, w: P.w, h: P.h,
      row0: h0, rows: r1 - h0, y0, th: y1 - y0, bb: P.bb, pos: pos.buffer, has: has.buffer, nrm: nrm ? nrm.buffer : null } };
  },
  // One evaluation, in bands of rows across the pool: four a worker for a noise, so the bar moves
  // as they land and a cancel stops within one band, and two for a pattern. A tile the pool has
  // not been handed goes with the first band each worker takes — an idle pool gives its first
  // `size` jobs one to a worker — and a band that still finds its worker without it goes again.
  // Its own lanes rather than `pool.map`, so that each band is copied out only as it is sent and
  // put into the sheet the moment it lands: assembled after the last one, the copies out and the
  // 16 MB back were one 25 ms block each on a 2048² bake (2026-09-26); spread, they are a band's worth.
  async run(job, bar){
    const P = job.P, pool = GradFill.pool();
    const M = job.kind === "tri" ? await GradFill.mipsFor(job.img) : null;
    if (M) job = Object.assign({}, job, { tile: GradFill.imgId(job.img) });
    const n = Math.max(1, Math.min(pool.size * (M ? 2 : 4), Math.floor(P.h / 32)));
    const carry = M && GradFill._tileIn !== job.tile ? pool.size : 0;
    const cv = mkCanvas(P.w, P.h), g = ctx2d(cv);
    let next = 0, done = 0, stop = false;
    const send = (b, tile) => { const j = GradFill.band(job, n, b, tile); return pool.call(j.op, j.args, j.transfer); };
    const lane = async () => {
      try {
        for (let b; !stop && (b = next++) < n; ) {
          if (bar && bar.cancelled()) throw new Cancelled();
          let r = await send(b, b < carry ? M : null);
          if (r && r.need) r = await send(b, M);                     // this worker had not been handed the tile
          g.putImageData(new ImageData(new Uint8ClampedArray(r), P.w, r.byteLength / (P.w * 4)), 0, Math.floor(P.h * b / n));
          if (bar) bar.tick(++done, n);
        }
      } catch (err) { stop = true; throw err; }                      // the other lanes stop after their band
    };
    await Promise.all(Array.from({ length: Math.min(n, pool.size) }, lane));
    if (M) GradFill._tileIn = job.tile;
    return cv;
  },
  // Resolves once this content's sheet is its CURRENT record's — what export and convert-to-paint
  // wait on. Throws when the evaluation failed, so an export stops rather than shipping a hole, and
  // throws `Cancelled` when it was cancelled, which each of them already reads as a cancel.
  async settle(slot, c, L){
    // an export or a convert asks NOW, so a record the user cancelled earlier is worked out again;
    // one cancelled while this waits is theirs to answer, and ends it
    if (c._proc && c._proc.why === "cancelled") c._proc.fail = c._proc.why = null;
    for (let n = 0; n < 8; n++) {
      if (!Bake.cached(slot, "pos") && GradFill.bakeable(slot)) await GradFill.enqueue(slot);
      const job = GradFill.job(slot, c, L);
      if (!job || c._gradKey === job.key) return;
      if (c._proc && c._proc.fail === job.key) {
        if (c._proc.why === "cancelled") throw new Cancelled();
        throw new Error(LayerNode.wordFor(c) + " on “" + (L ? L.name : "a layer") + "” could not be evaluated");
      }
      await GradFill.kick(slot, c, L, job);
    }
  },
  // Would a draw right now be the finished fill? Convert-to-paint's question: when it would not, it
  // goes round `render` and comes back with the pixels.
  ready(slot, c, L){
    if (GradFill.isAsync(c)) { const j = Bake.cached(slot, "pos") ? GradFill.job(slot, c, L) : null; return !!j && c._gradKey === j.key; }
    return !GradFill.isModel(c) || !!Bake.cached(slot, "pos");
  },
  // A tile's mip chain, built in the pool — §3.1 puts mip generation off this thread, and it
  // measured 67 ms for a 1024² tile and 113 ms for a 2048² one here (2026-09-26) — once per IMAGE,
  // so a slider dragged over a pattern re-evaluates without rebuilding it, and a duplicate layer,
  // which shares its original's tile, shares its chain too. It comes back PACKED
  // (`Procedural.pack`), the form each band is handed a copy of. A build that fails is not kept:
  // the next evaluation asks again, and the failure reaches the user through that evaluation.
  _mips: new WeakMap(),
  mipsFor(img){
    let p = GradFill._mips.get(img);
    if (p) return p;
    const cv = toCanvas(img), d = ctx2d(cv).getImageData(0, 0, cv.width, cv.height).data;
    p = GradFill.pool().call("mips", { rgba: d.buffer, w: cv.width, h: cv.height }, [d.buffer]);
    GradFill._mips.set(img, p);
    p.then(null, () => { if (GradFill._mips.get(img) === p) GradFill._mips.delete(img); });
    return p;
  },
  // A number per image object, for the keys: the image is pixels, not a record, and replacing it
  // (Image…) is a new object — the old one's sheets must not be mistaken for the new one's.
  _ids: new WeakMap(), _idN: 0,
  imgId(img){ let id = GradFill._ids.get(img); if (!id) GradFill._ids.set(img, id = ++GradFill._idN); return id; },
  // A pattern on the sheet: the tile through a canvas pattern, which the GPU fills in a few
  // milliseconds, so it is evaluated here and synchronously like a UV gradient — at the full
  // ALBEDO size, not the gradient's 2048² cap, because a pattern is detail and a gradient is not;
  // and at the albedo's size whatever channel it is on (the repeats are fractions of the sheet, so
  // a half-size surface sheet blits it down exactly, and a mask lent at the albedo's size keeps the
  // same key). A new canvas every time the key moves: a duplicate shares the cached one until then.
  uvPatSheet(slot, c){
    const img = c.patImg;
    if (!img || !img.width || !slot.composite) return null;
    const W = slot.composite.width, H = slot.composite.height, rec = Procedural.patClone(c.pat);
    const key = "uvpat|" + JSON.stringify(rec) + "|" + GradFill.imgId(img) + "|" + W + "x" + H;
    if (c._gradSheet && c._gradKey === key) return c._gradSheet;
    const out = mkCanvas(W, H), g = ctx2d(out);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    const pt = g.createPattern(img, "repeat");
    pt.setTransform(new DOMMatrix(Procedural.uvMatrix(rec, W, H, img.width, img.height)));
    g.fillStyle = pt; g.fillRect(0, 0, W, H);
    c._gradSheet = out; c._gradKey = key;
    return out;
  },
  // A lattice's tile (4.55): one period of it, LATTICE_W px wide and as tall as its aspect asks, drawn
  // from its record — a new canvas each time, which is what the pattern's caches key on. The fill is
  // ONE path of every cell, and the border one stroke over every outline: cells drawn one by one
  // would seam along each shared edge, two antialiased edges never summing to full coverage
  // (wt-canvas). Scales overlap, so each is filled and stroked in its turn.
  // `W` × `H` draws it at another size, stretched to it: the pattern brush's GPU tile is a power of two
  // each way, so it can repeat and mipmap, and a tile drawn at that size is sharper than one resampled
  // to it — canvas scaling clamps at a tile's edge (wt-canvas). Drawn in cell units through the
  // canvas's own transform (composed, never set: t151 slides the tile by translating the context), so a border stretched with its tile keeps its width in cells both ways.
  LATTICE_W: 512,
  latticeTile(rec, W = GradFill.LATTICE_W, H = 0){
    const l = Procedural.latticeClone(rec), C = Procedural.latticeCells(l.kind);
    H = H || Math.max(1, Math.round(W * C.h / C.w));
    const kx = W / C.w, ky = H / C.h, c = mkCanvas(W, H), g = ctx2d(c);
    g.scale(kx, ky);
    g.lineJoin = "miter"; g.lineWidth = l.width;
    g.fillStyle = l.fill; g.strokeStyle = l.border;
    const stroke = l.borderOn && l.width > 0;
    if (C.circles) {
      for (const [x, y, r] of C.circles) {
        g.beginPath(); g.ellipse(x, y, r, r, 0, 0, Math.PI * 2);
        if (l.fillOn) g.fill();
        else { g.save(); g.globalCompositeOperation = "destination-out"; g.fill(); g.restore(); }   // a scale hides the one above it
        if (stroke) g.stroke();
      }
      return c;
    }
    g.beginPath();
    for (const p of C.cells) {
      g.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
      g.closePath();
    }
    if (l.fillOn) g.fill();
    if (stroke) g.stroke();
    return c;
  },
  // The single-value maps a pattern is drawn onto as its luminance: the export packs their RED
  // channel alone (export/collect.js `surfPixels`), so a red tile would be all gloss and a blue one
  // none. Normal is left alone — two channels, and a tile of a normal map is exactly what goes there.
  GREY: ["smooth", "metal", "wear"],
  // One region of a fill onto `tg`, at the region's origin: a blit of the cached sheet.
  draw(cx, tg, c, L){
    const sh = GradFill.sheet(cx, c, L);
    if (!sh) return;
    if (c.pat && GradFill.GREY.includes(cx.ch)) { tg.filter = "grayscale(1)"; Composite.blit(cx, tg, sh); tg.filter = "none"; }
    else Composite.blit(cx, tg, sh);
  },
  // The whole sheet of a channel, as a canvas of its own — what convert-to-paint keeps. Along the
  // model this waits for the bake (and a noise or tri-planar pattern for its evaluation), which is
  // why it is async.
  async render(slot, ch, c, L){
    const base = chanBase(slot, ch) || slot.composite;
    const W = base.width, H = base.height;
    const out = mkCanvas(W, H);
    if (GradFill.isAsync(c)) await GradFill.settle(slot, c, L);
    else if (GradFill.isModel(c) && !Bake.cached(slot, "pos") && GradFill.bakeable(slot)) await GradFill.enqueue(slot);
    GradFill.draw({ slot, ch, W, H, sx: 0, sy: 0, tw: W, th: H }, ctx2d(out), c, L);
    return out;
  },
  // A gradient as a MASK (4.36's reference model, 4.44's second): the evaluated sheet, at the
  // albedo's size, whose alpha is the fade — what `LayerNode.maskSource` hands back for a fill
  // that carries a gradient, since a fill has no canvas of its own to lend. Null while a bake is
  // pending, which is the same "draws nothing, then asks" the layer itself shows.
  maskSheet(slot, src, c){
    if (!slot || !slot.composite || !c || !(c.grad || c.pat)) return null;
    const W = slot.composite.width, H = slot.composite.height;
    return GradFill.sheet({ slot, ch: "color", W, H, sx: 0, sy: 0, tw: W, th: H }, c.pat ? GradFill.maskContent(c) : c, src);
  },
  // A PATTERN lent as a mask reads its tile's BRIGHTNESS × alpha — white shows, black hides, and
  // transparent hides — the rule Mask ▸ image… reads an image by (`imageToMask`) and the one the
  // guide's Masks paragraph states. The first version lent the pattern's own sheet, whose alpha is
  // the tile's alone, so an opaque black-and-white stencil masked nothing: red over its black half
  // read (255, 0, 0) exactly as over its white half (review of 4.50 (7), 2026-09-26). A gradient and
  // a noise still lend their alpha; their stops carry it.
  // The mask is the same pattern drawn from the tile's LUMINANCE TILE (`lumTile`), which is exact
  // rather than close: both mappings average premultiplied texels and luminance is linear in them,
  // so the average of the brightness is the brightness of the average. It hangs off the content as
  // a shadow content (`_maskC`, never saved, dropped by `LayerNode.clone`, and by `pruneMasks` on the
  // sheet once nothing reads it) and goes through the same machinery as any fill — its own cached
  // sheet, and along the model its own evaluation in the pool with its own bar and latch — so none
  // of that is written twice.
  maskContent(c){
    const m = c._maskC || (c._maskC = { kind: "fill" });
    m.pat = c.pat; m.color = c.color; m.patName = c.patName;
    m.patImg = c.patImg ? GradFill.lumTile(c.patImg) : null;
    return m;
  },
  // The tile as a mask reads it: white, its alpha the brightness × the alpha — `imageToMask`'s
  // arithmetic to the byte, once per image. On this thread, at the TILE's size (at most 2048 on its
  // long side), not the sheet's: measured 2026-09-26 in headless Chrome, 1–3 ms for a 512² tile,
  // 12 for a 1024² one and 40–46 at the 2048² cap, once — where `imageToMask` does the same
  // arithmetic at the whole sheet's size.
  _lum: new WeakMap(),
  lumTile(img){
    let t = GradFill._lum.get(img);
    if (t) return t;
    const cv = toCanvas(img), w = cv.width, h = cv.height, d = ctx2d(cv).getImageData(0, 0, w, h), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      p[i+3] = (p[i] * 0.2126 + p[i+1] * 0.7152 + p[i+2] * 0.0722) * (p[i+3] / 255);
      p[i] = p[i+1] = p[i+2] = 255;
    }
    t = mkCanvas(w, h);
    ctx2d(t).putImageData(d, 0, 0);
    GradFill._lum.set(img, t);
    return t;
  },
  // The stops as a strip, for the layer list: the ramp left to right over the checkerboard the
  // thumbnail already has, whatever the gradient's shape or space — the way a gradient tool's icon
  // reads, and the same whether or not the sheet has been evaluated yet.
  thumb(g, grad, size){
    const img = g.createImageData(size, 1), lut = Gradient.lut(grad.stops);
    for (let x = 0; x < size; x++) {
      const k = Math.round(x / (size - 1) * (Gradient.N - 1));
      img.data[x*4] = lut[k*4]; img.data[x*4+1] = lut[k*4+1]; img.data[x*4+2] = lut[k*4+2]; img.data[x*4+3] = lut[k*4+3];
    }
    const strip = mkCanvas(size, 1);
    ctx2d(strip).putImageData(img, 0, 0);
    g.drawImage(strip, 0, 0, size, 1, 0, 0, size, size);
  },
  // The layer list's picture of any evaluated fill: a pattern is its tile twice each way, a noise
  // is its evaluated sheet once one has landed (the ramp until then), a gradient its ramp.
  thumbOf(g, c, size){
    if (c.pat && c.patImg) {
      const h = size / 2;
      g.imageSmoothingQuality = "high";
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) g.drawImage(c.patImg, x * h, y * h, h, h);
      return;
    }
    if (c.grad && c.grad.shape === "noise" && c._gradSheet) { g.drawImage(c._gradSheet, 0, 0, size, size); return; }
    if (c.grad) GradFill.thumb(g, c.grad, size);
  },
};
