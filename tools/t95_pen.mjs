// Pen pressure, stroke smoothing and Flow (ROADMAP 4.50 (4) + 6.4).
//
// WHY THIS EXISTS. All three are invisible when they are wrong in the plausible way: a pressure
// stroke that does not widen still paints, a Flow that is ignored still paints at Opacity, and a
// mouse read as a half-pressure pen paints a thinner line that nobody would call a bug. So each is
// held against an answer that is exact, in two halves:
//
//   Node, on the pure `/*==PEN==*/` section:
//   * pressure is a pen's only — a mouse's 0.5 and touch's guess are full pressure — and a pen's
//     coalesced samples come through in order, each with its own pressure (a mouse's do not);
//   * the string: off hands every sample through, a wobble inside it never moves the brush, and a
//     taut string keeps the brush exactly its length behind;
//   * the curve maps 0 → 0 and 1 → 1 for every setting and is monotone, so a mouse IS the brush as set;
//   * the dab walk at constant pressure is the loop it replaced, number for number, and at rising
//     pressure spaces each dab by its own size;
//   * the 3-D walk's one-segment case is the old `prev + (cur − prev) · t`, and a polyline is walked
//     along its arc, through its corners;
//   * Flow and wash / build-up: a lone dab lands at Flow × Opacity in both modes, a fill at Opacity
//     in both, and only the build-up of overlaps differs — capped at Opacity in a wash, not in build-up;
//   * a 3-D copy that lands on a dab already laid this sub-step is that dab: within 1/1024 of the
//     sheet, never under a texel and never over half the dab.
//
//   Headless Chrome, on the real page and the real stroke path:
//   * a pen stroke with rising pressure WIDENS MONOTONICALLY (the roadmap's gate), clipped to a
//     layer's limit or not, and a mouse stroke through the real pointer handler is full width;
//   * a stroke at Flow 20 % builds where it passes over itself and never past Opacity; Build up goes
//     past it; a mirrored copy (stroke channel 1) deposits at Flow like the stroke; the shape tool's
//     Fill lands at Opacity in both modes, with and without a mask;
//   * a pen's coalesced samples are followed through the real handler, and Smoothing holds the
//     brush back by its string and ignores a wobble inside it;
//   * the 3-D walk carries interpolated pressure into every sub-step and follows the pen's path at
//     the chord's ray budget; the recorder says a pen was used; undo is exact; Flow and what pressure
//     drives are remembered per tool;
//   * the 3-D view's OWN handlers, from PointerEvents on its canvas with only the ray stubbed (added
//     in review, 2026-09-26, after the move losing Pen.follow and the press losing Pen.begin each
//     left the rest of this test passing): a pen widens there too, a mouse is full, coalesced
//     samples are followed, Smoothing holds the brush back and the ring goes back under the pointer
//     when the stroke ends;
//   * a Shift+click line after a stroke that lifted off light is laid at the CLICK's pressure — a
//     mouse's is full — on the sheet, on the model from a stroke on the sheet, and on the model;
//   * Symmetry and the turned copies at Flow: where a part and its twin share their texels each
//     dab is laid once, as with Symmetry off, and a copy on texels of its own is still laid; a Panel
//     line there — a height field, which adds at any Flow — is as deep as with Symmetry off.
//
// The stroke's LATENCY with Flow and pressure on is `t47`'s, beside the rest of §3.3.
//
// Usage: node tools/t95_pen.mjs [--keep] [--chrome <path>]
import fs from "fs";
import { findBrowser, evalInPage, pageExpr, makeReport, ROOT } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const src = fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8");
const sectionOf = n => {
  const a = src.indexOf("\n/*==" + n + "==*/"), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("no " + n + " section in the page");
  return src.slice(a + 1, b);
};
const { Pen } = new Function(sectionOf("PEN").replace(/^"use strict";$/m, "") + "\nreturn { Pen };")();
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-9);
const brush = o => Object.assign({ size: 40, spacing: .35, opacity: 1, flow: 1, build: false, pSize: true, pFlow: true, curve: 1 }, o || {});

console.log("=== pressure is a pen's, and nothing else's ===");
{
  R.is(Pen.pressure({ pointerType: "mouse", pressure: .5 }) === 1 && Pen.pressure({ pointerType: "touch", pressure: .3 }) === 1,
    "a mouse (which reports 0.5 while pressed) and touch are full pressure");
  R.is(Pen.pressure({ pointerType: "pen", pressure: .3 }) === .3 && Pen.pressure({ pointerType: "pen", pressure: 0 }) === 0 &&
       Pen.pressure({ pointerType: "pen", pressure: 1.7 }) === 1 && Pen.pressure({ pointerType: "pen" }) === 0,
    "a pen's is its own, clamped to 0…1, and a pen reporting none is none");
  const ev = (x, p) => ({ pointerType: "pen", clientX: x, clientY: 5, pressure: p });
  const pen = Object.assign(ev(30, .9), { getCoalescedEvents: () => [ev(10, .2), ev(20, .5), ev(30, .9)] });
  const got = Pen.samples(pen);
  R.is(got.length === 3 && got.map(s => s.x).join() === "10,20,30" && got.map(s => s.p).join() === "0.2,0.5,0.9",
    `a pen's coalesced samples come through in order, each at its own pressure (${JSON.stringify(got)})`);
  const mouse = { pointerType: "mouse", clientX: 30, clientY: 5, pressure: .5, getCoalescedEvents: () => [ev(10, .2), ev(20, .5)] };
  R.is(Pen.samples(mouse).length === 1 && Pen.samples(mouse)[0].p === 1,
    "a mouse's move is its one sample, at full pressure — its coalesced events would only add 3-D raycasts");
  R.is(Pen.samples(Object.assign(ev(7, .4), { getCoalescedEvents: () => [] }))[0].x === 7 && Pen.samples(ev(8, .4))[0].x === 8,
    "and a pen move with no coalesced list (or no API for one) is the move itself");
}

console.log("\n=== the Smoothing string ===");
{
  const st = { x: 0, y: 0 };
  const off = [{ x: 3, y: 4, p: 1 }, { x: 3, y: 4, p: 1 }, { x: -2, y: 9, p: .5 }].map(s => Pen.pull(st, s, 0));
  R.is(off.every(q => q) && off[2].x === -2 && st.x === -2 && st.y === 9, "off (0 px) hands every sample through and the brush follows it");
  const s2 = { x: 0, y: 0 }, L = 10;
  const wobble = [[6, 0], [-5, 5], [0, -9], [7, 7], [-9.9, 0]].map(([x, y]) => Pen.pull(s2, { x, y, p: 1 }, L));
  R.is(wobble.every(q => q === null) && s2.x === 0 && s2.y === 0,
    "a wobble that stays inside the string never moves the brush — so it never reaches the sheet");
  const q = Pen.pull(s2, { x: 25, y: 0, p: .7 }, L);
  R.is(q && near(q.x, 15) && near(q.y, 0) && q.p === .7, `once the pointer is further than the string, the brush is pulled to exactly its length behind (${q && q.x})`);
  let worst = 0, st3 = { x: 0, y: 0 };
  for (let i = 1; i <= 200; i++) {
    const s = { x: i * 3, y: 12 * Math.sin(i / 7), p: 1 };
    const r = Pen.pull(st3, s, 20);
    worst = Math.max(worst, Math.hypot(s.x - st3.x, s.y - st3.y));
    if (r && (r.x !== st3.x || r.y !== st3.y)) worst = 1e9;
  }
  R.is(worst <= 20 + 1e-9, `and it is never longer than that: a winding path keeps the brush within 20 px of the pointer (${worst.toFixed(3)})`);
}

console.log("\n=== the curve, and what a dab is at a pressure ===");
{
  const ok = [.5, 1, 2].every(g => Pen.curve(0, g) === 0 && Pen.curve(1, g) === 1);
  let mono = true;
  for (const g of [.5, 1, 2]) for (let i = 1; i <= 100; i++) if (Pen.curve(i / 100, g) < Pen.curve((i - 1) / 100, g)) mono = false;
  R.is(ok && mono, "every curve maps 0 → 0 and 1 → 1 and never goes down");
  R.is(Pen.curve(.25, .5) > Pen.curve(.25, 1) && Pen.curve(.25, 1) > Pen.curve(.25, 2),
    `soft lays more for a light touch than linear, and firm less (${[.5, 1, 2].map(g => Pen.curve(.25, g).toFixed(3)).join(" / ")})`);
  const b = brush({ size: 37, curve: 2 });
  const mouseP = Pen.pressure({ pointerType: "mouse", pressure: .5 });
  R.is(Pen.size(b, mouseP) === 37 && Pen.flow(b, mouseP) === 1,
    "a mouse is the brush as set: with pressure driving size AND flow, it paints at the full size and flow");
  let widens = true;
  for (let i = 1; i <= 50; i++) if (Pen.size(b, i / 50) < Pen.size(b, (i - 1) / 50)) widens = false;
  R.is(widens && Pen.size(b, 0) === 1 && Pen.size(b, 1) === 37, `a pen's dab widens with pressure, from one texel to the full size (${Pen.size(b, 0)} → ${Pen.size(b, .5).toFixed(2)} → ${Pen.size(b, 1)})`);
  R.is(Pen.size(brush({ pSize: false }), .1) === 40 && Pen.flow(brush({ pFlow: false }), .1) === 1,
    "and pressure drives neither when the tool says not to");
}

console.log("\n=== the dabs along a segment ===");
{
  // The loop stampAt had until 2026-09-25, verbatim, as the oracle for constant pressure.
  const old = (last, px, py, b) => {
    const step = Math.max(1, b.size * (b.spacing || .35)), pts = [];
    const dx = px - last.x, dy = py - last.y, dist = Math.hypot(dx, dy);
    for (let d = step; d <= dist; d += step) pts.push([last.x + dx * d / dist, last.y + dy * d / dist]);
    return pts;
  };
  let same = true, n = 0;
  for (const [size, sp, pS] of [[48, .35, true], [7, .05, false], [400, 1, true], [2, .35, true], [33, .17, false]])
    for (const [ax, ay, bx, by] of [[10.3, 20.7, 900.1, 33.9], [0, 0, 1.5, 0], [500, 500, 13.37, 777.7], [5, 5, 5, 5]]) {
      const b = brush({ size, spacing: sp, pSize: pS });
      const A = old({ x: ax, y: ay }, bx, by, b), B = Pen.walk({ x: ax, y: ay, p: 1 }, bx, by, 1, b, false);
      n += A.length;
      if (A.length !== B.length || A.some((q, i) => q[0] !== B[i].x || q[1] !== B[i].y)) same = false;
    }
  R.is(same && n > 1000, `at full pressure every dab lands exactly where the old loop put it — ${n} dabs over 20 segments, compared with ===`);
  const b = brush({ size: 40, spacing: .25 });
  const w = Pen.walk({ x: 0, y: 0, p: .1 }, 400, 0, 1, b, false);
  const gaps = w.slice(1).map((q, i) => q.x - w[i].x);
  let rising = gaps.length > 5;
  for (let i = 1; i < gaps.length; i++) if (gaps[i] < gaps[i - 1] - 1e-9) rising = false;
  const linear = w.every(q => near(q.p, .1 + .9 * q.x / 400, 1e-12));
  R.is(rising && gaps[0] < 2 && gaps[gaps.length - 1] > 9,
    `under rising pressure each dab is spaced by its OWN size — ${gaps[0].toFixed(2)} texels apart where it is light, ${gaps[gaps.length - 1].toFixed(2)} where it is full`);
  R.is(linear, "and the pressure runs linearly along the segment, from the last dab's to the new sample's");
  R.is(Pen.walk({ x: 0, y: 0, p: 1 }, 3, 0, 1, b, false).length === 0 &&
       JSON.stringify(Pen.walk({ x: 0, y: 0, p: 1 }, 3, 0, .6, b, true)) === JSON.stringify([{ x: 3, y: 0, p: .6 }]),
    "a move shorter than one spacing adds nothing — except the endpoint of a straight line");
}

console.log("\n=== the 3-D walk: sub-steps along the pointer's path ===");
{
  let same = true;
  for (const [a, c, n] of [[{ x: 10.5, y: 3.25 }, { x: 99.1, y: -40.7, p: 1 }, 24], [{ x: 0, y: 0 }, { x: 1, y: 1, p: 1 }, 7], [{ x: 3, y: 3 }, { x: 3, y: 3, p: 1 }, 1]]) {
    const got = Pen.substeps([a, c], n);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (got[i - 1].x !== a.x + (c.x - a.x) * t || got[i - 1].y !== a.y + (c.y - a.y) * t) same = false;
    }
  }
  R.is(same, "one segment is the old prev + (cur − prev) · t, === at every step — a mouse casts the rays it always did");
  const V = [{ x: 0, y: 0, p: .2 }, { x: 50, y: 50, p: .6 }, { x: 100, y: 0, p: 1 }];
  const st = Pen.substeps(V, 10), L = Pen.arc(V);
  const onPath = st.every(q => near(Math.abs(q.y - (q.x <= 50 ? q.x : 100 - q.x)), 0, 1e-9));
  const even = st.every((q, i) => i === 0 || near(Math.hypot(q.x - st[i - 1].x, q.y - st[i - 1].y), L / 10, 1e-9) || near(q.x, 50, 25));
  R.is(near(L, 2 * Math.hypot(50, 50)) && onPath && Math.max(...st.map(q => q.y)) >= 49.99,
    `a polyline is walked along its arc and through its corner (length ${L.toFixed(2)}, highest step ${Math.max(...st.map(q => q.y)).toFixed(2)}) — the chord would have stayed on y = 0`);
  R.is(even && near(st[9].x, 100) && near(st[9].p, 1) && st.every((q, i) => i === 0 || q.p >= st[i - 1].p),
    "evenly by arc length, ending on the last sample, with the pressure rising along it");
}

console.log("\n=== Flow, and wash / build-up (6.4) ===");
{
  const w = Pen.deposit(brush({ opacity: .5, flow: .2 })), u = Pen.deposit(brush({ opacity: .5, flow: .2, build: true }));
  R.is(w.dab === .2 && w.apply === .5 && w.fill === 1 && near(u.dab, .1) && u.apply === 1 && u.fill === .5,
    `a wash lays dabs at Flow and applies the stroke at Opacity; Build up lays Flow × Opacity and applies at 1 (${JSON.stringify(w)} / ${JSON.stringify(u)})`);
  R.is(near(w.dab * w.apply, u.dab * u.apply) && near(w.fill * w.apply, .5) && near(u.fill * u.apply, .5),
    "so a lone dab lands at the same alpha in both, and a fill lands at Opacity in both — the switch only changes how overlaps build");
  const after = (d, n) => (1 - Math.pow(1 - d.dab, n)) * d.apply;
  R.is(after(w, 60) <= .5 && after(u, 60) > .9,
    `sixty overlapping dabs: a wash stops at Opacity (${after(w, 60).toFixed(3)}), Build up goes past it (${after(u, 60).toFixed(3)})`);
  R.is(JSON.stringify(Pen.deposit({ opacity: 1 })) === JSON.stringify({ dab: 1, apply: 1, fill: 1 }),
    "and a brush with no Flow set — a stored preset from before it existed — is exactly the old stroke");
}

console.log("\n=== a 3-D copy that lands on a dab already laid is that dab ===");
{
  const hits = [{ px: 100, py: 100 }, { px: 400, py: 90 }, { px: 250, py: 250 }];
  R.is(Pen.same([0], hits, 100, 100, 10, 2048) === 0 && Pen.same([0], hits, 101.9, 100, 10, 2048) === 0,
    "a copy on the stroke's own texel, or within 2 texels of it at 2048², is the stroke's own dab");
  R.is(Pen.same([0], hits, 102.1, 100, 10, 2048) === -1 && Pen.same([0], hits, 103.9, 100, 10, 4096) === 0 &&
       Pen.same([0], hits, 104.1, 100, 10, 4096) === -1,
    "further out it is a copy of its own — the reach is 1/1024 of the sheet, 2 texels at 2048² and 4 at 4096²");
  R.is(Pen.same([0], hits, 100.9, 100, 10, 512) === 0 && Pen.same([0], hits, 101.1, 100, 10, 512) === -1,
    "never under one texel, however small the sheet");
  R.is(Pen.same([0], hits, 100.4, 100, 1, 4096) === 0 && Pen.same([0], hits, 100.6, 100, 1, 4096) === -1,
    "and never over half the dab: a 2-texel dab 0.6 texels from another is a second dab");
  R.is(Pen.same([0, 2], hits, 250, 251, 10, 2048) === 2 && Pen.same([0], hits, 400, 90, 10, 2048) === -1 &&
       Pen.same([], hits, 100, 100, 10, 2048) === -1,
    "it answers with the channel it landed on, and asks only the channels laid this sub-step");
}

// ---------------------------------------------------------------- the page
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("\nSKIP (page half): no Chrome or Edge found. Pass --chrome <path> or set CHROME."); R.finish(); }

const BODY = `async function(){
  var out = {}, N = 512, seq = 0;
  function fnv(u8){ var h = 0x811c9dc5; for (var i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function hash(c){ return fnv(ctx2d(c).getImageData(0, 0, c.width, c.height).data); }
  function alpha(c, x, y){ return ctx2d(c).getImageData(x, y, 1, 1).data[3]; }
  function width(c, x, y0, span){ var d = ctx2d(c).getImageData(x, y0 - span, 1, 2 * span + 1).data, n = 0; for (var i = 3; i < d.length; i += 4) if (d[i] >= 128) n++; return n; }
  function maxAlpha(c, x, y, w, h){ var d = ctx2d(c).getImageData(x, y, w, h).data, m = 0; for (var i = 3; i < d.length; i += 4) if (d[i] > m) m = d[i]; return m; }
  function extent(c, y0, y1){ var d = ctx2d(c).getImageData(0, y0, N, y1 - y0).data, lo = N, hi = -1; for (var y = 0; y < y1 - y0; y++) for (var x = 0; x < N; x++) if (d[(y * N + x) * 4 + 3] >= 128) { if (x < lo) lo = x; if (x > hi) hi = x; } return { lo: lo, hi: hi }; }
  function monotone(a){ for (var i = 1; i < a.length; i++) if (a[i] < a[i - 1]) return false; return true; }
  var was = { slot: App.activeSlot, layer: App.activeLayer, p3: App.paint3d, mode: App.brush.mode, color: App.brush.color };
  var FIELDS = ["size", "opacity", "hardness", "spacing", "flow", "build", "pSize", "pFlow", "curve", "lazy", "heal", "value"];
  FIELDS.forEach(function(k){ was[k] = App.brush[k]; });
  function set(o){
    App.brush.mode = "color"; App.brush.color = "#ff0000";
    Object.assign(App.brush, { size: 40, opacity: 1, hardness: 1, spacing: .35, flow: 1, build: false, pSize: true, pFlow: false, curve: 1, lazy: 0, heal: false }, o || {});
    brushStamp._key = null;
  }
  function fresh(){
    var s = { id: "t95_" + (++seq), cStem: null, nStem: null, size: 0, layers: [], baseC: null, smooth: null, metal: null,
              normal: null, composite: null, tex: null, texCh: null, thumb: null, missing: true };
    App.slots.set(s.id, s);
    initPlaceholderAlbedo(s, N, N);
    App.activeSlot = s; App.activeLayer = null;
    flushComposites();
    return s;
  }
  function layer(){ return App.activeLayer ? App.activeLayer.canvas : null; }
  function penLine(x0, x1, y, p0, p1, steps){
    beginStroke(false, false);
    stroke.p = p0; stampAt(x0, y, 0, null);
    for (var i = 1; i <= steps; i++) { stroke.p = p0 + (p1 - p0) * i / steps; stampAt(x0 + (x1 - x0) * i / steps, y, 0, null); }
    endStroke();
  }
  function cols(c, y){ var a = []; for (var x = 60; x <= 440; x += 20) a.push(width(c, x, y, 30)); return a; }

  // ---- A. the roadmap's gate: a pen stroke with rising pressure widens monotonically ----
  App.paint3d = true;
  var s = fresh(); set({ spacing: .1 });
  var stampBefore = brushStamp();
  penLine(50, 450, 120, .1, 1, 40);
  out.widen = { plain: cols(layer(), 120), sameStamp: brushStamp() === stampBefore };
  // ...and through the masked branch, which draws each dab via the clip scratch: the layer limited
  // to a rectangle that covers the whole sheet, so the mask is real and changes no pixel.
  App.activeLayer.scope = Scope.make(null, { x: 0, y: 0, w: N, h: N });
  penLine(50, 450, 260, .1, 1, 40);
  out.widen.masked = cols(layer(), 260);
  out.widen.masking = true;
  App.activeLayer.scope = null;
  // Undo is exact: the stroke above comes off to the byte.
  var beforeUndo = hash(layer());
  penLine(50, 450, 400, .3, .9, 12);
  var afterStroke = hash(layer());
  doUndo();
  out.undo = { changed: afterStroke !== beforeUndo, back: hash(layer()) === beforeUndo };

  // ---- B. through the real 2-D pointer handler: a pen widens, a mouse is full width ----
  s = fresh(); set({ spacing: .1 });
  var cn = document.getElementById("view2d");
  fit2DNow();
  var rect = cn.getBoundingClientRect();
  var client = function(tx, ty){ return { x: rect.left + (tx * v2.sc + v2.ox) / devicePixelRatio, y: rect.top + (ty * v2.sc + v2.oy) / devicePixelRatio }; };
  var pe = function(type, tx, ty, kind, pr, co){
    var c = client(tx, ty);
    var init = { clientX: c.x, clientY: c.y, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true,
                 pointerId: 1, isPrimary: true, pointerType: kind, pressure: pr };
    if (co) init.coalescedEvents = co;
    return new PointerEvent(type, init);
  };
  var drag = function(kind, y, p0, p1){
    cn.dispatchEvent(pe("pointerdown", 50, y, kind, kind === "pen" ? p0 : .5));
    for (var i = 1; i <= 20; i++) cn.dispatchEvent(pe("pointermove", 50 + 20 * i, y, kind, kind === "pen" ? p0 + (p1 - p0) * i / 20 : .5));
    cn.dispatchEvent(pe("pointerup", 450, y, kind, 0));
  };
  out.view = { sc: v2.sc, w: rect.width, h: rect.height };
  set({ spacing: .1, pFlow: true });
  drag("mouse", 120, .5, .5);
  out.mouse = cols(layer(), 120);
  set({ spacing: .1 });                                      // size alone, so width is what moves
  drag("pen", 300, .1, 1);
  out.penEv = cols(layer(), 300);

  // ---- C. a pen's coalesced samples are followed: one move, a corner in the middle ----
  var probe = new PointerEvent("pointermove", { coalescedEvents: [new PointerEvent("pointermove", { clientX: 1 })] });
  out.coalescedInit = probe.getCoalescedEvents ? probe.getCoalescedEvents().length : -1;
  if (out.coalescedInit === 1) {
    set({ size: 12, spacing: .1 });
    cn.dispatchEvent(pe("pointerdown", 100, 470, "pen", 1));
    var mid = client(160, 420), end = client(220, 470);
    var co = [new PointerEvent("pointermove", { clientX: mid.x, clientY: mid.y, pointerType: "pen", pressure: 1 }),
              new PointerEvent("pointermove", { clientX: end.x, clientY: end.y, pointerType: "pen", pressure: 1 })];
    cn.dispatchEvent(pe("pointermove", 220, 470, "pen", 1, co));
    cn.dispatchEvent(pe("pointerup", 220, 470, "pen", 0));
    out.corner = { apex: alpha(layer(), 160, 422), chord: alpha(layer(), 160, 470) };
  }

  // ---- D. Flow builds within a stroke, and a wash never passes Opacity ----
  s = fresh(); set({ size: 30, opacity: .5, flow: .2 });
  beginStroke(false, false); stampAt(100, 100, 0, null); stampAt(400, 100, 0, null); endStroke();
  beginStroke(false, false); stampAt(100, 200, 0, null);
  for (var k = 0; k < 3; k++) { stampAt(400, 200, 0, null); stampAt(100, 200, 0, null); }
  endStroke();
  var Lc = layer();
  out.flow = { once: alpha(Lc, 250, 100), over: alpha(Lc, 250, 200), cap: maxAlpha(Lc, 60, 150, 390, 100) };

  // ---- E. Build up goes past Opacity; a lone dab is the same in both modes ----
  set({ size: 30, opacity: .5, flow: 1, build: true });
  beginStroke(false, false); stampAt(100, 300, 0, null);
  for (var k2 = 0; k2 < 3; k2++) { stampAt(400, 300, 0, null); stampAt(100, 300, 0, null); }
  endStroke();
  out.build = { over: alpha(layer(), 250, 300) };
  set({ size: 30, opacity: .5, flow: .6, build: false });
  beginStroke(false, false); stampAt(60, 420, 0, { jump: true }); endStroke();
  set({ size: 30, opacity: .5, flow: .6, build: true });
  beginStroke(false, false); stampAt(160, 420, 0, { jump: true }); endStroke();
  out.lone = { wash: alpha(layer(), 60, 420), build: alpha(layer(), 160, 420) };

  // ---- F. a mirrored copy (stroke channel 1) deposits at Flow like the stroke ----
  set({ size: 30, opacity: 1, flow: .4 });
  beginStroke(false, false); stampAt(300, 420, 0, { jump: true }); stampAt(420, 420, 1, { jump: true }); endStroke();
  out.copy = { stroke: alpha(layer(), 300, 420), mirror: alpha(layer(), 420, 420) };

  // ---- G. the shape tool's Fill lands at Opacity, in both modes, masked or not ----
  var square = function(x, y, w){ PathUI.path = Path.make(); [[x, y], [x + w, y], [x + w, y + w], [x, y + w]].forEach(function(q){ Path.add(PathUI.path, q[0], q[1]); }); PathUI.path.closed = true; };
  s = fresh();
  out.fill = {};
  [["wash", false, false], ["build", true, false], ["buildMasked", true, true]].forEach(function(c, i){
    set({ opacity: .6, flow: .2, build: c[1] });
    if (App.activeLayer) App.activeLayer.scope = c[2] ? Scope.make(null, { x: 0, y: 0, w: N, h: N }) : null;
    square(40 + i * 120, 40, 80); PathUI.fill();
    out.fill[c[0]] = alpha(layer(), 80 + i * 120, 80);
  });
  if (App.activeLayer) App.activeLayer.scope = null;
  PathUI.path = null;

  // ---- H. the 3-D walk, on a stub ray that maps the screen straight onto the sheet ----
  s = fresh(); set({ size: 20, spacing: .35 });
  var rayWas = ray3d, stampWas = stampAt, rays = [], seen = [];
  ray3d = function(ev){ rays.push({ x: ev.clientX, y: ev.clientY }); return { uv: { x: ev.clientX / N, y: 1 - ev.clientY / N }, point: new THREE.Vector3(ev.clientX, ev.clientY, 0), object: { name: "t95" } }; };
  stampAt = function(x, y, ch, opt){ seen.push(stroke.p); return stampWas(x, y, ch, opt); };
  try {
    beginStroke(false, true);
    Pen.begin(stroke, { pointerType: "pen", pressure: .2, clientX: 100, clientY: 100 });
    stroke.screen = { x: 100, y: 100, p: .2 };
    paint3dStrokeTo([{ x: 300, y: 100, p: 1 }]);
    out.walk3d = { pressures: seen.slice(), rays: rays.length };
    rays.length = 0;
    paint3dStrokeTo([{ x: 350, y: 150, p: 1 }, { x: 400, y: 100, p: 1 }]);
    out.walk3d.corner = Math.max.apply(null, rays.map(function(r){ return r.y; }));
    endStroke();
    // The budget: a straight 200 px move as eight coalesced samples casts what one sample of it does.
    var count = function(pts){ beginStroke(false, true); stroke.screen = { x: 50, y: 300, p: 1 }; rays.length = 0; paint3dStrokeTo(pts); var n = rays.length; endStroke(); return n; };
    var eight = []; for (var j = 1; j <= 8; j++) eight.push({ x: 50 + 25 * j, y: 300, p: 1 });
    out.walk3d.budget = { one: count([{ x: 250, y: 300, p: 1 }]), eight: count(eight) };
  } finally { ray3d = rayWas; stampAt = stampWas; }

  // ---- I. Smoothing: the brush trails the pointer on its string ----
  s = fresh(); set({ size: 10, spacing: .1, lazy: 30 });
  var dpr = devicePixelRatio, tpc = dpr / v2.sc;            // texels per client pixel
  var c0 = client(100, 200);
  var ev = function(type, cx, cy){ return new PointerEvent(type, { clientX: cx, clientY: cy, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: "mouse", pressure: .5 }); };
  cn.dispatchEvent(ev("pointerdown", c0.x, c0.y));
  [[20, 0], [-15, 18], [0, -25], [24, 14]].forEach(function(d){ cn.dispatchEvent(ev("pointermove", c0.x + d[0], c0.y + d[1])); });
  refreshStrokeView();                                       // the frame's worth, now: it is rAF-scheduled
  var shake = extent(layer(), 0, N);
  cn.dispatchEvent(ev("pointermove", c0.x + 100, c0.y));
  out.lazy = { shake: shake, ring: !!v2.lazy, tpc: tpc };
  cn.dispatchEvent(ev("pointerup", c0.x + 100, c0.y));
  out.lazy.after = extent(layer(), 150, 250);
  out.lazy.ringAfter = !!v2.lazy;

  // ---- J. the recorder says a pen was used ----
  s = fresh(); set({ spacing: .35 });
  recStart();
  drag("pen", 150, .4, .8);
  drag("mouse", 350, .5, .5);
  var rep = recStop();
  out.rec = { n: rep.strokes.length, pen: rep.strokes.map(function(x){ return x.pen; }).join(","),
              fields: rep.strokes[0] ? ["flow", "build", "lazy"].every(function(k){ return k in rep.strokes[0]; }) : false };

  // ---- K. Flow, Build up and what pressure drives are the tool's own (3.22's per-tool memory) ----
  App.brushTools = {};
  applyBrushMode("color");
  var slide = function(id, v){ var e = $(id); e.value = v; e.oninput({ target: e }); };
  var tick = function(id, v){ var e = $(id); e.checked = v; e.onchange({ target: e }); };
  slide("brushFlow", 30); tick("brushBuild", true); tick("penFlow", true);
  applyBrushMode("smooth");
  out.tools = { smooth: [App.brush.flow, App.brush.build, App.brush.pFlow].join(",") };
  applyBrushMode("color");
  out.tools.colour = [App.brush.flow, App.brush.build, App.brush.pFlow, $("brushFlowVal").textContent, $("brushBuild").checked].join(",");
  // A row stored before Flow existed takes the build's default, not whatever the last tool left.
  App.brushTools.metal = { size: 9, opacity: 1, hardness: .5, value: 200, spacing: .35 };
  applyBrushMode("metal");
  out.tools.oldRow = [App.brush.flow, App.brush.build, App.brush.size].join(",");
  applyBrushMode("height");
  out.tools.heightRows = [$("rowFlow").style.display, $("rowBuild").style.display].join("|");
  applyBrushMode("color");
  out.tools.colourRows = [$("rowFlow").style.display, $("rowBuild").style.display].join("|");
  App.brushTools = {};

  // ---- L. the Clone, with pressure and Match tone (whole-texel patches) ----
  s = fresh(); set({ spacing: .2 });
  penLine(20, 500, 60, 1, 1, 30);
  App.brush.mode = "clone"; App.brush.heal = true; App.brush.pSize = true; brushStamp._key = null;
  Clone.pick(s, 80, 60);
  var cloneThrew = null;
  try { penLine(60, 400, 300, .15, 1, 30); } catch (e) { cloneThrew = String(e && e.message || e); if (stroke) endStroke(); }
  out.clone = { threw: cloneThrew, painted: extent(layer(), 270, 330) };

  // ---- M. the 3-D view's own pointer handlers, from real PointerEvents on its canvas ----
  // H calls paint3dStrokeTo directly, so it could not see the handlers lose the pen: in review, the
  // 3-D move passing its bare position instead of Pen.follow's samples, and the 3-D press dropping
  // Pen.begin, each left H passing. Here only the ray is stubbed — one client pixel is one texel —
  // and the mirror and the turned copies are stubbed to land where a case says: on the stroke's own
  // texel (a part pair that shares its texels), or 200 texels over (a pair that does not).
  var c3 = document.getElementById("view3d");
  var was3 = { ray: ray3d, sym: symEnabled, mh: mirrorHit, rc: radialCount, rh: radialHit, rm: radialMirrorHit, w2s: worldToScreen, ring: updateBrushRing };
  var hit3 = null, symOn = false, copyAt = null, nCopies = 1, ringCalls = [];
  var mk3 = function(x, y){ return { uv: { x: x / N, y: 1 - y / N }, point: new THREE.Vector3(x, y, 0), object: { name: "t95" } }; };
  var pe3 = function(type, x, y, kind, pr, o){
    var init = { clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true,
                 pointerId: 1, isPrimary: true, pointerType: kind, pressure: pr };
    return new PointerEvent(type, Object.assign(init, o || {}));
  };
  var drag3 = function(kind, x0, x1, y, p0, p1, n){
    c3.dispatchEvent(pe3("pointerdown", x0, y, kind, kind === "pen" ? p0 : .5));
    for (var i = 1; i <= n; i++) c3.dispatchEvent(pe3("pointermove", x0 + (x1 - x0) * i / n, y, kind, kind === "pen" ? p0 + (p1 - p0) * i / n : .5));
    c3.dispatchEvent(pe3("pointerup", x1, y, kind, 0));
  };
  // A pen stroke on the SHEET from x 50 to 250 that lifts off light, the way a real pen does.
  var liftOff2 = function(y){
    cn.dispatchEvent(pe("pointerdown", 50, y, "pen", 1));
    for (var i = 1; i <= 10; i++) cn.dispatchEvent(pe("pointermove", 50 + 20 * i, y, "pen", 1 - .95 * i / 10));
    cn.dispatchEvent(pe("pointerup", 250, y, "pen", 0));
  };
  var click2 = function(tx, ty, kind, pr){
    var c = client(tx, ty), o = { clientX: c.x, clientY: c.y, button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 1,
                                 isPrimary: true, pointerType: kind, pressure: pr, shiftKey: true };
    cn.dispatchEvent(new PointerEvent("pointerdown", o));
    cn.dispatchEvent(new PointerEvent("pointerup", Object.assign(o, { buttons: 0, pressure: 0 })));
  };
  var along = function(c, y){ var a = []; for (var x = 290; x <= 450; x += 40) a.push(width(c, x, y, 30)); return a; };
  out.v3 = {};
  try {
    ray3d = function(ev){ hit3 = mk3(ev.clientX, ev.clientY); return hit3; };
    symEnabled = function(){ return symOn; };
    mirrorHit = function(){ return copyAt && hit3 ? copyAt(hit3) : null; };
    radialCount = function(){ return nCopies; };
    radialHit = function(){ return copyAt && hit3 ? copyAt(hit3) : null; };
    radialMirrorHit = function(){ return copyAt && hit3 ? copyAt(hit3) : null; };
    worldToScreen = function(v){ return { x: v.x, y: v.y }; };
    updateBrushRing = function(e){ ringCalls.push(e ? [e.clientX, e.clientY] : null); return was3.ring(e); };

    // M1. pressure, through the press and the moves; a mouse is the full brush
    s = fresh(); set({ spacing: .1 });
    recStart();
    drag3("pen", 50, 450, 120, .1, 1, 20);
    set({ spacing: .1, pFlow: true });
    drag3("mouse", 50, 450, 300, .5, .5, 20);
    var rep3 = recStop();
    out.v3.pen = cols(layer(), 120); out.v3.mouse = cols(layer(), 300);
    out.v3.recPen = rep3.strokes.map(function(x){ return x.pen; }).join(",");

    // M2. one pen move whose coalesced samples turn a corner
    if (out.coalescedInit === 1) {
      set({ size: 12, spacing: .1 });
      c3.dispatchEvent(pe3("pointerdown", 100, 470, "pen", 1));
      c3.dispatchEvent(pe3("pointermove", 220, 470, "pen", 1, { coalescedEvents: [
        new PointerEvent("pointermove", { clientX: 160, clientY: 420, pointerType: "pen", pressure: 1 }),
        new PointerEvent("pointermove", { clientX: 220, clientY: 470, pointerType: "pen", pressure: 1 })] }));
      c3.dispatchEvent(pe3("pointerup", 220, 470, "pen", 0));
      out.v3.corner = { apex: alpha(layer(), 160, 422), chord: alpha(layer(), 160, 470) };
    }

    // M3. Smoothing on the model, and where the ring goes
    s = fresh(); set({ size: 10, spacing: .1, lazy: 30 });
    c3.dispatchEvent(pe3("pointerdown", 100, 200, "mouse", .5));
    [[20, 0], [-15, 18], [0, -25], [24, 14]].forEach(function(d){ c3.dispatchEvent(pe3("pointermove", 100 + d[0], 200 + d[1], "mouse", .5)); });
    refreshStrokeView();
    var shake3 = extent(layer(), 0, N);
    ringCalls.length = 0;
    c3.dispatchEvent(pe3("pointermove", 200, 200, "mouse", .5));
    var ringMid = ringCalls[ringCalls.length - 1];
    c3.dispatchEvent(pe3("pointerup", 200, 200, "mouse", 0));
    out.v3.lazy = { shake: shake3, after: extent(layer(), 150, 250), ringMid: ringMid, ringEnd: ringCalls[ringCalls.length - 1] };

    // M4. a Shift+click line after a stroke that lifted off light starts at the click's pressure
    s = fresh(); set({ spacing: .1 });
    liftOff2(60);  click2(470, 60, "mouse", .5);             // on the sheet, with a mouse
    liftOff2(160); click2(470, 160, "pen", .8);              // on the sheet, with a pen at 0.8
    liftOff2(260);                                           // on the model, from a stroke on the sheet
    c3.dispatchEvent(pe3("pointerdown", 470, 260, "mouse", .5, { shiftKey: true }));
    c3.dispatchEvent(pe3("pointerup", 470, 260, "mouse", 0));
    drag3("pen", 50, 250, 360, 1, .05, 10);                  // on the model, from a stroke on the model
    c3.dispatchEvent(pe3("pointerdown", 470, 360, "mouse", .5, { shiftKey: true }));
    c3.dispatchEvent(pe3("pointerup", 470, 360, "mouse", 0));
    out.v3.lines = { m2: along(layer(), 60), p2: along(layer(), 160), m3: along(layer(), 260), a3: along(layer(), 360) };

    // M5. Symmetry and the turned copies at Flow, on texels shared with the stroke and on their own
    s = fresh();
    var pass = function(y){ drag3("mouse", 40, 200, y, .5, .5, 16); return alpha(layer(), 120, y); };
    var shared = function(h){ return mk3(h.point.x, h.point.y); }, apart = function(h){ return mk3(h.point.x + 200, h.point.y); };
    var Y = out.v3.sym = {};
    set({ size: 20, flow: .3 });
    symOn = false; copyAt = null; nCopies = 1; Y.offW = pass(60);
    symOn = true; copyAt = shared;
    recStart(); Y.onW = pass(120); Y.shared = recStop().strokes[0].shared;
    nCopies = 3; Y.radW = pass(180); nCopies = 1;
    copyAt = apart; Y.ownS = pass(240); Y.ownC = alpha(layer(), 320, 240);
    set({ size: 20, opacity: .5, flow: .3, build: true });
    symOn = false; copyAt = null; Y.offB = pass(300);
    symOn = true; copyAt = shared; Y.onB = pass(360);

    // M6. a Panel line over shared texels — a height field, which adds at ANY Flow, so a copy laid on
    // the stroke's own dab doubled its depth before Flow existed
    var groove = function(on){
      var id = "t95_" + (++seq), hs = { id: id, size: N, nSize: N, layers: [], missing: false };
      var grey = function(hex){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
      hs.baseC = grey("#404040"); hs.composite = grey("#404040"); hs.smooth = grey("#505050"); hs.metal = grey("#303030"); hs.normal = grey("#8080ff");
      App.slots.set(id, hs); App.activeSlot = hs; App.activeLayer = null;
      set({ size: 20, spacing: .35 }); App.brush.mode = "height"; App.brush.value = 170; brushStamp._key = null;
      symOn = on; copyAt = on ? shared : null;
      drag3("mouse", 40, 200, 100, .5, .5, 16);
      var L = layerLeaves(hs.layers).filter(function(l){ return l.chan === "normal"; })[0];
      if (!L) return null;
      var d = ctx2d(L.canvas).getImageData(0, 0, N, N).data, g = [];
      for (var x = 80; x <= 160; x += 20) g.push(d[((104 * N + x) * 4) + 1]);   // G = normal Y, on the wall
      return g;
    };
    Y.heightOff = groove(false); Y.heightOn = groove(true);
    symOn = false; copyAt = null;
  } finally {
    ray3d = was3.ray; symEnabled = was3.sym; mirrorHit = was3.mh; radialCount = was3.rc; radialHit = was3.rh;
    radialMirrorHit = was3.rm; worldToScreen = was3.w2s; updateBrushRing = was3.ring;
    if (stroke) endStroke();
    lastPtr3 = null;
  }

  // restore
  FIELDS.forEach(function(k){ App.brush[k] = was[k]; });
  App.brush.mode = was.mode; App.brush.color = was.color; brushStamp._key = null;
  App.activeSlot = was.slot; App.activeLayer = was.layer; App.paint3d = was.p3;
  for (var i2 = 1; i2 <= seq; i2++) App.slots.delete("t95_" + i2);
  App.undoStack.length = 0; App.redoStack.length = 0;
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 800), timeoutMs: 180000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log("\n=== in the page: a pen stroke with rising pressure widens monotonically (the roadmap's gate) ===");
const W = r.widen;
console.log(`   plain  ${W.plain.join(" ")}\n   masked ${W.masked.join(" ")}`);
const widens = a => a.every((v, i) => i === 0 || v >= a[i - 1]) && a[0] <= 8 && a[a.length - 1] >= 36;
R.is(widens(W.plain), `pressure 0.1 → 1 along the stroke: ${W.plain[0]} texels wide at the light end, ${W.plain[W.plain.length - 1]} at the full one, never narrower on the way`);
R.is(widens(W.masked), "and the same through the masked branch — a layer limited to a rectangle, where each dab is clipped in a scratch first");
R.is(W.sameStamp, "and the stamp canvas is the one it started with — the size is applied when each dab is drawn, so brushStamp._key never gained a per-dab size");
R.is(r.undo.changed && r.undo.back, "a pressure stroke comes off with one undo, to the byte");

console.log("\n=== through the real pointer handler ===");
console.log(`   2-D view ${Math.round(r.view.w)}×${Math.round(r.view.h)} px at ${r.view.sc.toFixed(3)}`);
console.log(`   mouse  ${r.mouse.join(" ")}\n   pen    ${r.penEv.join(" ")}`);
R.is(r.view.w > 50 && r.view.h > 50, "the 2-D view has a size to drive (the harness lays it out)");
R.is(r.mouse.every(v => v >= 36 && v <= 44), `a mouse stroke is the full brush all the way along, though it reports pressure 0.5 and pressure drives size and flow (${Math.min(...r.mouse)}–${Math.max(...r.mouse)} texels)`);
R.is(widens(r.penEv), `a pen stroke from real PointerEvents widens with its pressure (${r.penEv[0]} → ${r.penEv[r.penEv.length - 1]})`);
if (r.coalescedInit === 1)
  R.is(r.corner.apex >= 128 && r.corner.chord < 128,
    `a pen's coalesced samples are followed: one move with a corner in it paints the corner (alpha ${r.corner.apex}) and not the chord that skips it (${r.corner.chord})`);
else console.log(`  skip this Chrome cannot build a PointerEvent with coalesced events (${r.coalescedInit}), so the coalesced path is held by the Node half only`);

console.log("\n=== Flow and wash / build-up on the real stroke buffer (6.4) ===");
console.log(`   Opacity 50 %, Flow 20 %: one pass ${r.flow.once}, over itself six times ${r.flow.over}, highest anywhere ${r.flow.cap} (Opacity is 128)`);
R.is(r.flow.over > r.flow.once + 20, `the stroke builds up where it passes over itself (${r.flow.once} → ${r.flow.over}) — at Flow 100 % both would be 128`);
R.is(r.flow.cap <= 129, `and a wash never passes Opacity, however often (${r.flow.cap})`);
R.is(r.build.over > 200, `Build up goes past it: Opacity 50 %, the same six passes, ${r.build.over}`);
R.is(Math.abs(r.lone.wash - r.lone.build) <= 1 && Math.abs(r.lone.wash - 77) <= 2,
  `a lone dab at Flow 60 % × Opacity 50 % lands at the same alpha in both modes (${r.lone.wash} / ${r.lone.build}, want 77)`);
R.is(Math.abs(r.copy.stroke - 102) <= 2 && Math.abs(r.copy.mirror - r.copy.stroke) <= 1,
  `a mirrored copy (stroke channel 1, which radial copies share the path of) deposits at Flow like the stroke (${r.copy.stroke} / ${r.copy.mirror}, want 102)`);
R.is(Object.values(r.fill).every(v => Math.abs(v - 153) <= 1),
  `the shape tool's Fill lands at Opacity 60 % whatever Flow says, in a wash, with Build up, and with Build up under a mask (${JSON.stringify(r.fill)}, want 153)`);

console.log("\n=== the 3-D walk ===");
const P3 = r.walk3d, PS = P3.pressures.map(p => typeof p === "number" ? p : NaN);
console.log(`   pressures seen by stampAt: ${PS.map(p => p.toFixed(2)).join(" ") || "none — no sub-step stamped"}`);
R.is(PS.length > 5 && PS.every((p, i) => i === 0 || p >= PS[i - 1]) && PS[1] < .5 && PS[PS.length - 1] === 1,
  `every raycast sub-step carries the pressure interpolated along the move into its stamps (${P3.rays} rays, ${PS.length > 1 ? PS[1].toFixed(2) : "?"} … 1)`);
R.is(P3.corner >= 140, `a move whose samples turn a corner is walked through the corner (highest ray at y ${P3.corner}), not along the chord`);
R.is(P3.budget.one > 0 && P3.budget.eight === P3.budget.one, `and eight coalesced samples along a line cast the rays one sample of it does (${P3.budget.eight} vs ${P3.budget.one})`);

console.log("\n=== Smoothing ===");
const Z = r.lazy, pull = 30 * Z.tpc;
console.log(`   ${Z.tpc.toFixed(3)} texels per screen pixel · after the wobble ${Z.shake.lo}–${Z.shake.hi} · after the stroke ${Z.after.lo}–${Z.after.hi}`);
R.is(Z.shake.hi >= Z.shake.lo && Z.shake.hi - Z.shake.lo <= 12,
  `a wobble inside the 30 px string (up to ${Math.round(28 * Z.tpc)} texels here) never moves the brush: the first dab is all there is (${Z.shake.hi - Z.shake.lo + 1} texels across)`);
const want = 100 + 70 * Z.tpc;
R.is(Z.after.hi <= want + 7 && Z.after.hi >= want - 3 * Z.tpc - 7,
  `then the brush follows 30 screen px behind the pointer — the stroke ends at ${Z.after.hi}, the string's end is ${want.toFixed(1)} and the pointer ${(100 + 100 * Z.tpc).toFixed(1)}`);
R.is(Z.ring && !Z.ringAfter, "mid-stroke the 2-D ring is drawn at the string's end, and lets go of it when the stroke ends");

console.log("\n=== the recorder, the per-tool memory, the Clone ===");
R.is(r.rec.n === 2 && r.rec.pen === "true,false" && r.rec.fields, `each stroke says whether a pen drove it (${r.rec.pen}) and how Flow, Build up and Smoothing were set`);
const T = r.tools;
R.is(T.smooth === "1,false,false" && T.colour === "0.3,true,true,30,true",
  `Flow, Build up and pressure → flow are the tool's own: set on the colour brush, fresh on Smoothness (${T.smooth}), back on the colour brush (${T.colour})`);
R.is(T.oldRow === "1,false,9", `a tool row stored before Flow existed takes the build's default for it, not the last tool's (${T.oldRow})`);
R.is(T.heightRows === "none|none" && T.colourRows === "|", "Panel line — a height field, which always adds — shows no Flow or Build up row; the colour brush does");
R.is(!r.clone.threw && r.clone.painted.hi > 300, r.clone.threw ? "the Clone threw under pressure: " + r.clone.threw
  : `the Clone paints under pressure with Match tone on — its patches are whole texels (${r.clone.painted.lo}–${r.clone.painted.hi})`);

console.log("\n=== the 3-D view's own pointer handlers, from real PointerEvents ===");
const V = r.v3;
console.log(`   pen    ${V.pen.join(" ")}\n   mouse  ${V.mouse.join(" ")}`);
R.is(widens(V.pen), `a pen stroke on the model widens with its pressure — the press lays the first dab light and every move carries its own (${V.pen[0]} → ${V.pen[V.pen.length - 1]})`);
R.is(V.mouse.every(v => v >= 36 && v <= 44), `a mouse stroke on the model is the full brush all the way along (${Math.min(...V.mouse)}–${Math.max(...V.mouse)} texels)`);
R.is(V.recPen === "true,false", `the recorder says a pen drove the first stroke on the model and not the second (${V.recPen})`);
if (V.corner)
  R.is(V.corner.apex >= 128 && V.corner.chord < 128,
    `a pen move whose coalesced samples turn a corner is painted through the corner (alpha ${V.corner.apex}), not along the chord (${V.corner.chord})`);
const Z3 = V.lazy;
console.log(`   Smoothing 30 px: after the wobble ${Z3.shake.lo}–${Z3.shake.hi} · after the stroke ${Z3.after.lo}–${Z3.after.hi} · ring mid-stroke ${Z3.ringMid} · after it ${Z3.ringEnd}`);
R.is(Z3.shake.hi - Z3.shake.lo <= 11, `a wobble inside the string never moves the brush on the model either: the first dab is all there is (${Z3.shake.hi - Z3.shake.lo + 1} texels across)`);
R.is(Z3.after.hi >= 172 && Z3.after.hi <= 176, `then the brush follows 30 px behind the pointer — the stroke ends at ${Z3.after.hi}, the string's end is 170 and the pointer 200`);
R.is(String(Z3.ringMid) === "170,200" && String(Z3.ringEnd) === "200,200",
  `the ring on the model is placed at the string's end mid-stroke (${Z3.ringMid}) and back under the pointer once the stroke ends (${Z3.ringEnd})`);
const Ln = V.lines, flat = (a, w) => a.every(v => Math.abs(v - w) <= 2);
console.log(`   Shift+click lines after a pen that lifted off at 0.05, widths from x 290 to 450:\n     sheet, mouse ${Ln.m2.join(" ")} · sheet, pen at 0.8 ${Ln.p2.join(" ")} · model from the sheet, mouse ${Ln.m3.join(" ")} · model from the model, mouse ${Ln.a3.join(" ")}`);
R.is(flat(Ln.m2, 40), `a mouse Shift+click line is the full brush from its first texel (${Ln.m2.join(" ")}) — not tapered up from the pressure the last stroke lifted off at`);
R.is(flat(Ln.p2, 32), `a pen's Shift+click line is laid at the click's pressure all along: 0.8 of 40 is 32 (${Ln.p2.join(" ")})`);
R.is(flat(Ln.m3, 40) && flat(Ln.a3, 40),
  `and the 3-D view agrees, whether its line starts from a stroke on the sheet (${Ln.m3.join(" ")}) or on the model (${Ln.a3.join(" ")})`);
const Y = V.sym;
console.log(`   Flow 30 %: Symmetry off ${Y.offW}, on over shared texels ${Y.onW}, with three turned copies as well ${Y.radW}; on own texels the stroke ${Y.ownS} and its copy ${Y.ownC}\n   Build up, Opacity 50 %, Flow 30 %: off ${Y.offB}, on over shared texels ${Y.onB}`);
R.is(Y.onW === Y.offW && Y.radW === Y.offW,
  `where a part and its twin share their texels, Symmetry lays each dab once — ${Y.offW} with it off, ${Y.onW} with it on, ${Y.radW} with three turned copies and their mirrors too (each copy laid again gave 131 / 194 / 252)`);
R.is(Y.onB === Y.offB, `and with Build up the same (${Y.offB} / ${Y.onB}; laid again, 71 / 122)`);
R.is(Y.ownS === Y.offW && Math.abs(Y.ownC - Y.ownS) <= 1, `a copy on texels of its own is still laid, at Flow like the stroke (${Y.ownS} / ${Y.ownC})`);
R.is(Y.shared > 0, `and the recorder counts the copies that were the stroke's own dab (${Y.shared} in one stroke)`);
console.log(`   Panel line, normal G on the groove's wall: Symmetry off ${Y.heightOff}, on over shared texels ${Y.heightOn}`);
R.is(Y.heightOff && Y.heightOn && Y.heightOff.some(v => Math.abs(v - 128) > 10) && Y.heightOff.every((v, i) => Math.abs(v - Y.heightOn[i]) <= 1),
  "a Panel line — a height field, which adds at any Flow — is as deep with Symmetry on over shared texels as with it off");

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
