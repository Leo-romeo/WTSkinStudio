// A brush shows how it will paint before the stroke, and its colour can run along it
// (ROADMAP 3.41 (1) and (3), 4.56 first part).
//
// WHY THIS EXISTS. A preview that is drawn by its own code is a second brush, and the first time the
// two disagree the panel is lying about the stroke. So the sample stroke is held to the stroke's own
// walk and dabs, and the colour cycle to answers that are exact:
//
//   Node, on the pure `/*==PEN==*/` and `/*==GRADIENT==*/` sections:
//   * `Pen.sample` is `Pen.walk` + `Pen.heading` + `Pen.dab` along its curve, dab for dab — replayed
//     here by hand; it fits its box (size, and scatter's reach), keeps the brush's Spacing in the
//     brush's own sizes, holds still under a fixed seed, and never tapers for a pen;
//   * `Pen.turnHue` is exact: a whole turn is the colour it started as, a third of one takes red to
//     green, a grey has no hue to turn; `Pen.ink` runs Hue round the wheel once per cycle and a
//     preset there and back, and is null for every brush but the colour brush on a layer's content;
//   * `Gradient.HOLO`'s presets are opaque, ordered, and copied fresh each time they are asked for.
//
//   Headless Chrome, on the real page:
//   * the tip grid lists every tip the select does, a loaded one included, each a picture drawn by
//     the preview's own code; a click picks it and closes the grid, Escape closes it, and a press
//     elsewhere does too;
//   * the sample stroke paints, changes with the tip, Spacing, scatter, colour and Opacity, and its
//     texels are the ones `Pen.sample`'s dabs laid by `Tips.lay` give — so it cannot disagree;
//   * a stroke with the colour cycling on Hue lays the brush colour where it starts and the turned
//     hue a third of a cycle on, a preset lays its own colours, Off is the plain stroke to the byte,
//     and the eraser ignores a cycle it was given; the cycle is the tool's, and a settings row;
//   * the gradient panel's holo preset replaces the stops in one undo step.
//
// Usage: node tools/t153_preview.mjs [--keep] [--chrome <path>]
import fs from "fs";
import { findBrowser, evalInPage, pageExpr, makeReport, ROOT } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const src = fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8");
const sectionOf = n => {
  const a = src.search(new RegExp("[\\n>]/\\*==" + n + "==\\*/")), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("no " + n + " section in the page");
  return src.slice(a + 1, b);
};
const { Pen } = new Function(sectionOf("PEN").replace(/^"use strict";$/m, "") + "\nreturn { Pen };")();
const { Gradient } = new Function(sectionOf("GRADIENT").replace(/^"use strict";$/m, "") + "\nreturn { Gradient };")();
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const brush = o => Object.assign({ tool: "brush", chan: "color", target: "content", color: "#ff0000", size: 48, opacity: 1, hardness: .7,
  spacing: .15, flow: 1, build: false, pSize: true, pFlow: false, curve: 1, tip: "round", sizeJit: 0, flowJit: 0, scatter: 0,
  angle: 0, angleJit: 0, follow: false, cycle: "off", cycleLen: 10 }, o || {});

console.log("=== the sample stroke is the stroke's own walk ===");
{
  const W = 240, H = 44, b = brush({ follow: true, sizeJit: .4, scatter: .5 });
  const S = Pen.sample(b, W, H);
  // Replayed by hand: the curve sampled the way `sample` samples it, each point through walk / heading /
  // dab with the brush at the sample's size and a stream from the fixed seed.
  const bb = Object.assign({}, b, { size: S.size }), sc = .5, m = S.size / 2 * (1 + 2 * sc) + 2, A = H / 2 - m;
  const at = t => ({ x: m + (W - 2 * m) * t, y: H / 2 - A * Math.sin(2 * Math.PI * t), p: 1 });
  const rnd = Pen.rng(Pen.SAMPLE_SEED), N = Math.max(8, Math.ceil((W - 2 * m) / 2)), ref = [];
  let last = at(0), head = null;
  ref.push(Pen.dab(bb, last, head, rnd));
  for (let i = 1; i <= N; i++) {
    const s = at(i / N), pts = Pen.walk(last, s.x, s.y, 1, bb);
    head = Pen.heading(last, s.x, s.y, null, head);
    for (const q of pts) { ref.push(Pen.dab(bb, q, head, rnd)); last = q; }
  }
  const key = d => [d.x, d.y, d.size, d.flow, d.angle].join();
  R.is(S.dabs.length === ref.length && S.dabs.every((d, i) => key(d) === key(ref[i])),
    `${S.dabs.length} dabs, each where walk, heading and dab put it with every dynamic on — the same numbers a stroke computes (${ref.length} replayed)`);
  const reach = Math.max(...S.dabs.map(d => Math.max(Math.abs(d.y - H / 2) + d.size / 2)));
  R.is(S.size <= (H - 4) / (1 + 2 * sc) + 1e-9 && reach <= H / 2 + 1e-9,
    `it fits its ${W} × ${H} box: the brush laid at ${S.size.toFixed(1)} texels so scatter's disc stays inside (furthest reach ${reach.toFixed(1)} of ${H / 2})`);
  const again = Pen.sample(b, W, H);
  R.is(again.dabs.every((d, i) => key(d) === key(S.dabs[i])), "and it holds still: the same brush lays the same sample, dab for dab");
  const plain = Pen.sample(brush({ size: 20, spacing: .25 }), W, H).dabs;
  const steps = plain.slice(1).map((d, i) => Math.hypot(d.x - plain[i].x, d.y - plain[i].y));
  R.is(steps.every(s => Math.abs(s - 5) < 1e-6) && plain.every(d => d.size === 20 && d.flow === 1),
    `a 20-texel brush at 25 % Spacing is laid at its own size, every dab 5 texels from the last along the curve (${Math.min(...steps).toFixed(3)}–${Math.max(...steps).toFixed(3)})`);
  const big = Pen.sample(brush({ size: 400, spacing: .25 }), W, H);
  const bs = big.dabs.slice(1).map((d, i) => Math.hypot(d.x - big.dabs[i].x, d.y - big.dabs[i].y));
  R.is(big.size === 40 && bs.every(s => Math.abs(s - 10) < 1e-6),
    `a 400-texel brush is laid at 40 and keeps its Spacing in its own sizes: steps of ${bs[0].toFixed(3)}, a quarter of the dab`);
  const pen = Pen.sample(brush({ pSize: true, pFlow: true }), W, H).dabs;
  R.is(pen.every(d => d.size === pen[0].size && d.flow === 1), "it is laid at full pressure, as a mouse paints it — not tapered for a pen the user may not have");
  const runs = plain.map(d => d.run), arc = steps.reduce((a, s) => a + s, 0);
  R.is(runs[0] === 0 && runs.every((r, i) => !i || r > runs[i - 1]) && Math.abs(runs[runs.length - 1] - arc) < 1e-6,
    `each dab carries the distance painted to it, from 0 to the curve's ${arc.toFixed(1)} texels`);
}

console.log("\n=== the colour along the stroke ===");
{
  const red = [255, 0, 0], olive = Pen.hex("#8a9a5b");
  R.is(same(Pen.turnHue(red, 1 / 3), [0, 255, 0]) && same(Pen.turnHue(red, 2 / 3), [0, 0, 255]) && same(Pen.turnHue(red, 1 / 6), [255, 255, 0]),
    `a third of a turn takes red to green, two thirds to blue, a sixth to yellow — HSV, exact at the primaries`);
  let worst = 0;
  for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let bl = 0; bl < 256; bl += 17) {
    const c = Pen.turnHue([r, g, bl], 1), d = Math.max(Math.abs(c[0] - r), Math.abs(c[1] - g), Math.abs(c[2] - bl));
    if (d > worst) worst = d;
  }
  R.is(worst === 0, `a whole turn is the colour it started as, over 4 096 colours (worst ${worst})`);
  const half = Pen.turnHue(olive, .5), back = Pen.turnHue(half, .5);
  const mx = c => Math.max(...c), mn = c => Math.min(...c);
  R.is(mx(half) === mx(olive) && Math.abs((mx(half) - mn(half)) - (mx(olive) - mn(olive))) <= 1 && Math.max(...back.map((v, i) => Math.abs(v - olive[i]))) <= 1,
    `turning keeps a colour's value and chroma: olive ${olive} → ${half} → ${back}`);
  R.is(same(Pen.turnHue([128, 128, 128], .3), [128, 128, 128]), "a grey has no hue to turn, and comes back as it went");

  const hue = brush({ cycle: "hue", cycleLen: 10, size: 20 });
  R.is(same(Pen.ink(hue, 0), red) && same(Pen.ink(hue, 200 / 3), [0, 255, 0]) && same(Pen.ink(hue, 200), red),
    "Hue: the brush colour where the stroke starts, green a third of the way into a 10-size cycle (66.7 texels at 20), red again at 200");
  const lut = Gradient.holoLut("rainbow"), n = lut.length / 4, px = k => [lut[k * 4], lut[k * 4 + 1], lut[k * 4 + 2]];
  const pre = brush({ cycle: "rainbow", cycleLen: 10, size: 20 });
  R.is(same(Pen.ink(pre, 0, lut), px(0)) && same(Pen.ink(pre, 200, lut), px(n - 1)) && same(Pen.ink(pre, 400, lut), px(0)) && same(Pen.ink(pre, 100, lut), Pen.ink(pre, 300, lut)),
    "a preset runs there and back: its first colour at the start, its last at one cycle, its first again at two, and the same colour either side of the turn");
  const off = ["off", ""].map(c => Pen.ink(brush({ cycle: c }), 50));
  const others = [{ tool: "eraser" }, { chan: "smooth" }, { target: "mask" }, { tool: "clone" }, { cycleLen: 0 }].map(o => Pen.ink(brush(Object.assign({ cycle: "hue" }, o)), 50));
  R.is(off.every(v => v === null) && others.every(v => v === null),
    "and nothing at all where it is off, nor for the eraser, a value channel, a mask, the Clone or a cycle of no length — only the colour brush has a colour to vary");
}

console.log("\n=== the holographic presets ===");
{
  const ok = Gradient.HOLO.every(P => P.stops.length >= 4 && P.stops.every(([t, c], i) => /^#[0-9a-f]{6}$/.test(c) && t >= 0 && t <= 1 && (!i || t > P.stops[i - 1][0])) && P.stops[0][0] === 0 && P.stops[P.stops.length - 1][0] === 1);
  R.is(ok && Gradient.HOLO.length >= 5 && new Set(Gradient.HOLO.map(P => P.id)).size === Gradient.HOLO.length,
    `${Gradient.HOLO.length} presets (${Gradient.HOLO.map(P => P.name).join(", ")}), each four or more ordered stops from 0 to 1 in #rrggbb`);
  const a = Gradient.holo("foil"), b2 = Gradient.holo("foil");
  a[0].color = "#000000";
  R.is(b2[0].color !== "#000000" && a.every(s => s.alpha === 1) && Gradient.holo("nope") === null,
    "asked for, a preset is a fresh copy of opaque stops — editing one gradient's stops changes no other — and an unknown name is none");
  const fade = [{ t: 0, color: "#ffffff", alpha: 1 }, { t: 1, color: "#ffffff", alpha: 0 }], over = Gradient.holoOver("rainbow", fade);
  R.is(over.map(s => s.color).join() === Gradient.holo("rainbow").map(s => s.color).join() && over.every(s => Math.abs(s.alpha - (1 - s.t)) <= 1 / 255 + 1e-9),
    `laid over a colour fading to nothing, a preset takes the fade's alpha at each of its stops (${over.map(s => s.alpha.toFixed(2)).join(" ")}) — its colours, the user's transparency`);
  R.is(Gradient.holoLut("oil") === Gradient.holoLut("oil") && Gradient.holoLut("oil").length === Gradient.N * 4, "its table is made once and kept, since a stroke asks for it on every dab");
}

// ---------------------------------------------------------------- the page
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("\nSKIP (page half): no Chrome or Edge found. Pass --chrome <path> or set CHROME."); R.finish(); }

const BODY = `async function(){
  var out = {}, N = 256, seq = 0;
  function fnv(u8){ var h = 0x811c9dc5; for (var i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function hash(c){ return fnv(ctx2d(c).getImageData(0, 0, c.width, c.height).data); }
  function px(c, x, y){ return Array.from(ctx2d(c).getImageData(x, y, 1, 1).data); }
  var FIELDS = ["size", "opacity", "hardness", "spacing", "flow", "build", "tip", "sizeJit", "flowJit", "scatter", "angle", "angleJit", "follow", "cycle", "cycleLen", "color"];
  var was = { slot: App.activeSlot, layer: App.activeLayer, mode: App.brush.mode, tools: JSON.stringify(App.brushTools || {}) };
  FIELDS.forEach(function(k){ was[k] = App.brush[k]; });
  function set(o){
    applyBrushMode("color");
    Object.assign(App.brush, { color: "#ff0000", size: 20, opacity: 1, hardness: 1, spacing: .1, flow: 1, build: false, tip: "round",
      sizeJit: 0, flowJit: 0, scatter: 0, angle: 0, angleJit: 0, follow: false, cycle: "off", cycleLen: 10 }, o || {});
    brushStamp._key = null;
  }
  function fresh(){
    var s = { id: "t147_" + (++seq), cStem: null, nStem: null, size: 0, layers: [], baseC: null, smooth: null, metal: null,
              normal: null, composite: null, tex: null, texCh: null, thumb: null, missing: true };
    App.slots.set(s.id, s);
    initPlaceholderAlbedo(s, N, N);
    App.activeSlot = s; App.activeLayer = null;
    flushComposites();
    return s;
  }
  function layer(){ return App.activeLayer ? App.activeLayer.canvas : null; }
  function line(pts){ beginStroke(false, false); pts.forEach(function(p){ stampAt(p[0], p[1], 0, null); }); endStroke(); }
  function sample(){ BrushPanel.sample(); return hash($("brushSample")); }
  try {

  // ---- A. the tip grid ----
  set();
  var grid = $("tipGrid"), btn = $("btnTipPick");
  out.grid = { hidden0: grid.hidden };
  btn.click();
  var opts = Array.prototype.map.call($("brushTip").options, function(o){ return o.value; });
  var cells = Array.prototype.map.call(grid.children, function(c){ return c.dataset.tip; });
  out.grid.open = !grid.hidden && btn.getAttribute("aria-expanded") === "true";
  out.grid.same = cells.join() === opts.join();
  out.grid.selected = Array.prototype.filter.call(grid.children, function(c){ return c.getAttribute("aria-selected") === "true"; }).map(function(c){ return c.dataset.tip; });
  // Each cell is the preview's own picture of that tip.
  var ref = mkCanvas(BrushPanel.TIP_CELL, BrushPanel.TIP_CELL); BrushPanel.drawTip(ref, "rivet");
  var rcell = grid.querySelector('[data-tip="rivet"] canvas');
  out.grid.drawn = hash(rcell) === hash(ref);
  var dist = {}; Array.prototype.forEach.call(grid.querySelectorAll("canvas"), function(c){ dist[hash(c)] = 1; });
  out.grid.distinct = Object.keys(dist).length;
  grid.querySelector('[data-tip="chip"]').click();
  out.grid.picked = App.brush.tip === "chip" && $("brushTip").value === "chip" && grid.hidden && btn.getAttribute("aria-expanded") === "false";
  btn.click();
  // Opening it puts focus on the tip in hand, so the keys reach the grid from where the user is.
  var foc = document.activeElement;
  out.grid.focus = !!foc && foc.parentNode === grid && foc.dataset.tip === "chip";
  foc.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft", key: "ArrowLeft", bubbles: true }));
  out.grid.arrow = document.activeElement && document.activeElement.dataset.tip === "rivet";
  document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true }));
  out.grid.esc = grid.hidden && document.activeElement === btn;
  btn.click();
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  out.grid.away = grid.hidden;
  // A loaded tip has a cell of its own, drawn from its picture.
  var tc = mkCanvas(32, 16), tg = ctx2d(tc); tg.fillStyle = "#000"; tg.fillRect(4, 4, 24, 8);     // a bar on transparent
  var T = Tips.fromImage(tg.getImageData(0, 0, 32, 16).data, 32, 16);
  var id = await Tips.add(T, "t153 bar");
  BrushPanel.tipOptions();
  btn.click();
  var cell = grid.querySelector('[data-tip="' + id + '"]');
  out.grid.loaded = !!cell && cell.title === "t153 bar";
  out.grid.loadedWhy = { id: id, cells: Array.prototype.map.call(grid.children, function(c){ return c.dataset.tip + "=" + c.title; }).join("|") };
  var lr = mkCanvas(BrushPanel.TIP_CELL, BrushPanel.TIP_CELL); BrushPanel.drawTip(lr, id);
  out.grid.loadedDrawn = !!cell && hash(cell.querySelector("canvas")) === hash(lr);
  BrushPanel.tipGrid(false);
  await Tips.remove(id); BrushPanel.tipOptions();

  // ---- B. the sample stroke ----
  set();
  var c = $("brushSample"), h0 = sample();
  var d = ctx2d(c).getImageData(0, 0, c.width, c.height).data, lit = 0;
  for (var i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
  out.sample = { lit: lit, w: c.width, h: c.height };
  // Its texels are Pen.sample's dabs laid by Tips.lay with the stamp brushStamp.make gives — the code
  // a stroke runs. Replayed here with one buffer and the Opacity applied once.
  set({ tip: "square", angle: 30, follow: true, spacing: .3, opacity: .6, flow: .7 });
  var S = Pen.sample(App.brush, c.width, c.height), Tt = Tips.get("square");
  var st = brushStamp.make(Tt, Math.max(2, Math.round(S.size)), 1, "#ff0000");
  var buf = mkCanvas(c.width, c.height), bg = ctx2d(buf);
  S.dabs.forEach(function(q){ bg.globalAlpha = .7 * q.flow; Tips.lay(bg, st, q.x, q.y, q.size, q.angle); });
  var refc = mkCanvas(c.width, c.height), rg = ctx2d(refc); rg.globalAlpha = .6; rg.drawImage(buf, 0, 0);
  out.sample.replay = sample() === hash(refc);
  // With the colour cycling, a big brush's sample shows the colours its stroke has: run is at the
  // sample's size, so the cycle is asked at that size too. Size 400, Hue every 2 sizes.
  set({ size: 400, cycle: "hue", cycleLen: 2 });
  var S2 = Pen.sample(App.brush, c.width, c.height), b2 = Object.assign({}, App.brush, { size: S2.size });
  var st2 = brushStamp.make(Tips.get("round"), Math.max(2, Math.round(S2.size)), 1, "#ff0000");
  var buf2 = mkCanvas(c.width, c.height), bg2 = ctx2d(buf2);
  S2.dabs.forEach(function(q){ bg2.globalAlpha = q.flow; Tips.layIn(bg2, st2, q.x, q.y, q.size, 0, 2 * Tips.reach(st2, q.size, 0), null, null, Pen.ink(b2, q.run, null)); });
  out.sample.cycle = sample() === hash(buf2);
  out.sample.turns = Pen.phase(b2, S2.dabs[S2.dabs.length - 1].run);
  var hs = {};
  set(); hs.base = sample();
  set({ tip: "chip" }); hs.tip = sample();
  set({ spacing: .9 }); hs.spacing = sample();
  set({ scatter: 1 }); hs.scatter = sample();
  set({ color: "#00ff00" }); hs.color = sample();
  set({ opacity: .3 }); hs.opacity = sample();
  set(); hs.again = sample();
  out.sample.hs = hs;
  // It is redrawn by the controls themselves, once a frame.
  set(); BrushPanel.sample();
  var hb = hash(c);
  $("brushSpacing").value = 80; $("brushSpacing").dispatchEvent(new Event("input"));
  await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); });
  out.sample.live = hash(c) !== hb;
  set();
  applyBrushMode("height");
  out.sample.heightHidden = $("rowSample").style.display === "none";
  applyBrushMode("color");

  // ---- C. a stroke with the colour cycling ----
  var s = fresh();
  set({ cycle: "off" });
  line([[20, 40], [230, 40]]);
  var plain = hash(layer());
  s = fresh(); set({ cycle: "off" });
  line([[20, 40], [230, 40]]);
  out.cycle = { offSame: hash(layer()) === plain };
  // Size 20, a 10-size cycle: one turn per 200 texels. At x = 20 + 200/3 the hue has turned a third.
  s = fresh(); set({ cycle: "hue", cycleLen: 10, hardness: 1, spacing: .05 });
  line([[20, 40], [230, 40]]);
  // A texel shows the LAST dab over it: at Hardness 100 one laid about half a dab (10) past it, so the
  // texel at x carries the colour of the dab laid x − 10 texels into the stroke, which began at 20.
  out.cycle.start = px(layer(), 11, 40);
  out.cycle.third = px(layer(), 77, 40);
  out.cycle.end = px(layer(), 210, 40);
  s = fresh(); set({ cycle: "rainbow", cycleLen: 10, hardness: 1, spacing: .05 });
  line([[20, 40], [230, 40]]);
  out.cycle.preset = [px(layer(), 11, 40), px(layer(), 110, 40)];
  out.cycle.lut = (function(){ var l = Gradient.holoLut("rainbow"), n = l.length / 4, m = Math.round(.5 * (n - 1)) * 4; return [[l[0], l[1], l[2]], [l[m], l[m + 1], l[m + 2]]]; })();
  // Undo takes a cycled stroke off like any other.
  var before = hash(layer()), depth0 = App.undoStack.length; doUndo(true); out.cycle.undo = depth0 > 0 && (!layer() || hash(layer()) !== before);
  // The cycle is the tool's: set on the colour brush, not carried to the eraser, back on return.
  set({ cycle: "foil" }); $("brushCycle").value = "foil";
  applyBrushMode("erase");
  out.cycle.eraser = App.brush.cycle;
  out.cycle.disabled = $("brushCycle").disabled;
  applyBrushMode("color");
  out.cycle.back = App.brush.cycle;
  out.cycle.options = Array.prototype.map.call($("brushCycle").options, function(o){ return o.value; });
  // A grey brush on Hue says why nothing changes.
  set({ cycle: "hue", color: "#808080" }); BrushPanel.syncCycle();
  out.cycle.greyHint = $("cycleHint").style.display !== "none" && /grey/.test($("cycleHint").textContent);
  set({ cycle: "hue", color: "#ff0000" }); BrushPanel.syncCycle();
  out.cycle.redHint = $("cycleHint").style.display === "none";

  // ---- D. the gradient panel's holo preset ----
  s = fresh();
  out.holo = await (async function(){
    var node = LayerNode.of({ type: "fill", name: "t153 grad", chan: "color", color: "#ffffff", opacity: 1, blend: "normal", visible: true, grad: Gradient.make("uv", "#ffffff") });
    s.layers.push(node); App.activeLayer = node;
    refreshLayerList(); refreshLayerProps();
    var sel = Array.prototype.find.call(document.querySelectorAll("select"), function(e){ return e.options[0] && e.options[0].textContent === "holo preset…"; });
    if (!sel) return { found: false };
    var depth = App.undoStack.length;
    sel.value = "oil"; sel.dispatchEvent(new Event("change"));
    var g = LayerNode.contentOn(node, "color").grad;
    var r = { found: true, stops: g.stops.map(function(x){ return x.color; }).join(), want: Gradient.holo("oil").map(function(x){ return x.color; }).join(), steps: App.undoStack.length - depth, reset: sel.value === "",
              fade: g.stops.every(function(x){ return Math.abs(x.alpha - (1 - x.t)) <= .01; }) };
    doUndo(true);
    r.undone = LayerNode.contentOn(node, "color").grad.stops.length === 2;
    return r;
  })();

  } catch (e) { out.__threw = String(e && e.stack || e); }
  finally {
    applyBrushMode(was.mode);
    FIELDS.forEach(function(k){ App.brush[k] = was[k]; });
    App.brushTools = JSON.parse(was.tools);
    App.activeSlot = was.slot; App.activeLayer = was.layer;
    for (var i2 = 1; i2 <= seq; i2++) App.slots.delete("t147_" + i2);
    App.undoStack.length = 0; App.redoStack.length = 0;
  }
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log("\n=== in the page: every tip by its look ===");
const G = r.grid;
R.is(G.hidden0 && G.open, "the grid is closed until the preview is clicked, and says it is open when it is");
R.is(G.same && G.selected.join() === "round", `it lists every tip the select does, in its order, and marks the one in hand (${G.selected})`);
R.is(G.drawn && G.distinct >= 4, `each cell is the preview's own picture of its tip — the Rivet's to the byte — and the built-ins look different (${G.distinct} different pictures)`);
R.is(G.picked, "a click picks the tip — the brush, the select — and closes the grid");
R.is(G.focus && G.arrow, "opening it puts focus on the tip in hand, and the arrow keys move along the tips");
R.is(G.esc && G.away, "Escape from there closes it and gives focus back to the preview, and a press anywhere else closes it too");
R.is(G.loaded && G.loadedDrawn, "a tip the user loaded has its own cell, named, drawn from its picture" + (G.loaded && G.loadedDrawn ? "" : " — " + JSON.stringify(G.loadedWhy)));

console.log("\n=== the sample stroke ===");
const S = r.sample;
R.is(S.lit > 600, `a stroke is drawn in the ${S.w} × ${S.h} sample (${S.lit} texels painted)`);
R.is(S.replay, "its texels are Pen.sample's dabs laid by Tips.lay in the stamp brushStamp.make gives — a turned Square following the curve at Flow 70 % and Opacity 60 %, to the byte");
const hs = S.hs;
R.is(S.cycle && S.turns > 2, `a 400-texel brush cycling Hue every 2 sizes shows the stroke's own colours: ${S.turns.toFixed(2)} turns along the sample, laid dab by dab as the stroke tints them`);
R.is(hs.tip !== hs.base && hs.spacing !== hs.base && hs.scatter !== hs.base && hs.color !== hs.base && hs.opacity !== hs.base && hs.again === hs.base,
  "it changes with the tip, Spacing, scatter, colour and Opacity — and is the same picture again when they go back");
R.is(S.live, "moving a slider redraws it, on the next frame");
R.is(S.heightHidden, "Panel line, which lays a bump and no stamp, has no sample to show");

console.log("\n=== the colour along a real stroke ===");
const C = r.cycle;
R.is(C.offSame, "with the cycle off a stroke is the plain stroke, to the byte");
const close = (a, b, e) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= e);
// One texel is 1/200 of a turn here, 7.65 levels at most on a channel: the tolerance is two of them.
R.is(close(C.start, [255, 0, 0], 16) && C.start[3] === 255 && close(C.third, [0, 255, 0], 16) && C.third[3] === 255 && close(C.end, [255, 0, 0], 16),
  `on Hue the stroke starts in the brush colour (${C.start.slice(0, 3)}), is green a third of a 10-size cycle on (${C.third.slice(0, 3)}) and red again a whole one on (${C.end.slice(0, 3)})`);
R.is(close(C.preset[0], C.lut[0], 16) && close(C.preset[1], C.lut[1], 16),
  `a preset lays its own colours: its first at the start (${C.preset[0].slice(0, 3)}), its middle half a cycle on (${C.preset[1].slice(0, 3)} against ${C.lut[1]})`);
R.is(C.undo, "and a cycled stroke comes off with undo");
R.is(C.eraser === "off" && C.disabled && C.back === "foil", `the cycle is the tool's: the eraser has its own (${C.eraser}) and the row is off for it; back on the brush, ${C.back}`);
R.is(C.options.slice(0, 2).join() === "off,hue" && C.options.length === 2 + 5, `Off, Hue and the five presets are its choices (${C.options.join(", ")})`);
R.is(C.greyHint && C.redHint, "Hue on a grey brush says it has no hue to turn; on a colour it says nothing");

console.log("\n=== the gradient panel's holo presets ===");
const Ho = r.holo;
R.is(Ho.found && Ho.stops === Ho.want && Ho.fade && Ho.steps === 1 && Ho.reset && Ho.undone,
  Ho.found ? `picking Oil slick on a new fill gives it Oil slick's colours and keeps its fade to nothing (${Ho.steps} undo step, the select back on its prompt), and undo puts the two old stops back` : "the gradient panel has a holo preset select");

const errs = (r.__errs || []).filter(e => !/net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
