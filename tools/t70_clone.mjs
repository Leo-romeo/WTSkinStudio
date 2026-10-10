// The Clone brush: paint with pixels from elsewhere on the sheet (ROADMAP 4.44, fourth candidate).
//
// WHY THIS EXISTS. Every game albedo has rivets, panel lines and dirt worth copying to where a
// marking was removed, and the tool that does it is the ordinary stroke machinery with one change:
// where a stamp's pixels come from. The properties held here are the ones that make it a clone
// rather than a smear, in the real page against real strokes:
//
//   * with no source set it refuses in words, naming Alt+click;
//   * a stamp copies the source's pixels at the offset the first stamp fixed — the red square
//     lands where the brush is, its edge where the offset says, and a texel outside the brush is
//     untouched;
//   * the offset is kept across strokes (aligned): a second stroke elsewhere copies from
//     "there + offset", not from the source point again;
//   * **a stroke reads the sheet as it was when the stroke began, never its own output** — cloning
//     a gradient over itself with an offset shorter than the brush, with a composited frame between
//     every stamp, gives base(x − offset) exactly and not the value the previous stamp put down;
//   * Match tone shifts a copy to the mean under the brush — a dot from a dark panel lands with
//     light surroundings on a light one — and off, the copy is exact;
//   * the same tool on the normal map writes the normal layer, through the channel composite;
//   * undo takes the stroke off whole, and the panel's row says what state the source is in.
//
// Usage: node tools/t70_clone.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {}, N = 512;
  var px = function(c, x, y){ var d = ctx2d(c).getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
  var fnv = function(u8){ var h = 0x811c9dc5; for (var i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
  var hash = function(c){ return fnv(ctx2d(c).getImageData(0, 0, c.width, c.height).data); };
  var frame = function(){ return new Promise(function(r){ requestAnimationFrame(r); }); };
  // The base: grey, a red square at (100..140, 100..140), a black→white ramp along x in rows
  // 300..340, and in rows 400..480 a dark left half holding one white dot at (128, 440) beside a
  // light right half.
  var base = function(){
    var c = mkCanvas(N, N), g = ctx2d(c);
    g.fillStyle = "#808080"; g.fillRect(0, 0, N, N);
    g.fillStyle = "#ff0000"; g.fillRect(100, 100, 40, 40);
    var gr = g.createLinearGradient(0, 0, N, 0); gr.addColorStop(0, "#000"); gr.addColorStop(1, "#fff");
    g.fillStyle = gr; g.fillRect(0, 300, N, 40);
    g.fillStyle = "#282828"; g.fillRect(0, 400, 256, 80);
    g.fillStyle = "#c8c8c8"; g.fillRect(256, 400, 256, 80);
    g.fillStyle = "#ffffff"; g.fillRect(126, 438, 4, 4);
    return c;
  };
  var flat = function(hex){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
  var s = { id: "t70", size: N, nSize: N, layers: [], missing: false, baseC: base(), composite: base(),
            smooth: flat("#303030"), metal: flat("#606060"), normal: flat("#8080ff") };
  ctx2d(s.normal).fillStyle = "#c040ff"; ctx2d(s.normal).fillRect(100, 100, 40, 40);
  App.slots.set("t70", s);
  var was = { slot: App.activeSlot, layer: App.activeLayer, mode: App.brush.mode, size: App.brush.size,
              op: App.brush.opacity, hard: App.brush.hardness, sp: App.brush.spacing, heal: App.brush.heal, p3: App.paint3d };
  App.activeSlot = s; App.activeLayer = null; App.paint3d = true;
  App.brush.mode = "clone"; App.brush.size = 40; App.brush.opacity = 1; App.brush.hardness = 1; App.brush.spacing = .35;
  App.brush.heal = false; brushStamp._key = null;
  var comp = function(){ flushComposites(); return s.composite; };
  var status = function(){ return document.getElementById("status").textContent; };
  var stampOnce = function(x, y){ beginStroke(false, false); stampAt(x, y, 0, null); endStroke(); comp(); };
  comp();

  // ---- 1. no source: refused, in words ----
  document.getElementById("status").textContent = "";
  out.refused = { began: beginStroke(false, false), said: status(), layers: s.layers.length };
  if (stroke) endStroke();

  // ---- 2. one stamp copies the square, at the offset the stamp fixed ----
  Clone.pick(s, 120, 120);
  out.picked = { said: status(), src: s._cloneSrc && { x: s._cloneSrc.x, y: s._cloneSrc.y, off: s._cloneSrc.off.slice() } };
  var before = hash(comp());
  stampOnce(320, 120);
  out.square = { centre: px(s.composite, 320, 120), inEdge: px(s.composite, 335, 120), pastEdge: px(s.composite, 345, 120),
                 farLeft: px(s.composite, 305, 120), outside: px(s.composite, 350, 120),
                 off: s._cloneSrc.off[0] && { x: s._cloneSrc.off[0].x, y: s._cloneSrc.off[0].y }, layers: s.layers.length };

  // ---- 3. aligned: the next stroke copies from there + offset, not from the source again ----
  stampOnce(320, 320);
  out.aligned = { got: px(s.composite, 320, 320), wantBase: px(s.baseC, 120, 320), notBase: px(s.baseC, 320, 320) };

  // ---- 4. no feedback: the gradient cloned over itself, a frame between every stamp ----
  // The source starts in the sheet's first 256-texel tile and the stroke walks the second, so by
  // its last stamps the source has crossed into a tile earlier stamps of the same stroke already
  // wrote and composited. Copying that tile on first READ would take the stroke's own output.
  Clone.pick(s, 100, 320);                                    // offset −200
  beginStroke(false, false);
  for (var x = 300; x <= 500; x += 30) { stampAt(x, 320, 0, null); await frame(); comp(); }
  endStroke(); comp();
  out.feedback = { got: px(s.composite, 480, 320), want: px(s.baseC, 280, 320), smear: px(s.baseC, 80, 320) };

  // ---- 5. match tone ----
  Clone.pick(s, 128, 440);
  stampOnce(440, 440);                                        // exact copy: the dot's dark surroundings come along
  out.exact = { beside: px(s.composite, 448, 440), dot: px(s.composite, 440, 440) };
  App.brush.heal = true;
  Clone.pick(s, 128, 440);
  stampOnce(384, 440);
  out.healed = { beside: px(s.composite, 392, 440), dot: px(s.composite, 384, 440), light: px(s.baseC, 392, 440) };
  App.brush.heal = false;

  // ---- 6. undo takes the last stroke off whole ----
  var afterHeal = hash(s.composite);
  doUndo(); comp();
  out.undo = { back: px(s.composite, 392, 440), light: px(s.baseC, 392, 440) };
  doRedo(); comp();
  out.undo.redo = hash(s.composite) === afterHeal;

  // ---- 7. the normal map ----
  App.brush.mode = "cloneN"; brushStamp._key = null;
  App.activeLayer = null;
  Clone.pick(s, 120, 120);
  stampOnce(320, 120);
  var nOut = chanOut(s, "normal");
  out.normal = { mode: App.brush.mode, got: px(nOut, 320, 120), outside: px(nOut, 350, 120),
                 layerChans: s.layers.map(function(L){ return LayerNode.channelsOf(L).join("+"); }) };

  // ---- 8. the panel's row ----
  App.activeLayer = null; s._cloneSrc = null;
  applyBrushMode("clone");
  var row = document.getElementById("rowClone"), hint = document.getElementById("cloneHint");
  out.panel = { shown: row.style.display, noSrc: hint.textContent };
  Clone.pick(s, 10, 10); BrushPanel.cloneHint();
  out.panel.picked = hint.textContent;
  stampOnce(200, 200); BrushPanel.cloneHint();
  out.panel.aligned = hint.textContent;
  applyBrushMode("color");
  out.panel.hiddenForColour = row.style.display;
  out.refusal = { smooth: Tool.resolve("clone", "smooth", "content"), mask: Tool.resolve("clone", "color", "mask") };

  App.activeSlot = was.slot; App.activeLayer = was.layer; App.brush.mode = was.mode; App.brush.size = was.size;
  App.brush.opacity = was.op; App.brush.hardness = was.hard; App.brush.spacing = was.sp; App.brush.heal = was.heal; App.paint3d = was.p3;
  brushStamp._key = null;
  App.slots.delete("t70");
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 400), timeoutMs: 90000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

const near = (a, b, tol) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const rgb = a => a.slice(0, 3).join(",");

console.log("-- no source");
R.is(r.refused.began === false && /Alt-click/.test(r.refused.said) && r.refused.layers === 0,
  `with no source the stroke is refused and names Alt+click, and no layer was made for it: "${r.refused.said}"`);
console.log("-- one stamp");
R.is(r.picked.src && r.picked.src.x === 120 && r.picked.src.off[0] === null, `Alt+click sets the source and clears the offset: "${r.picked.said}"`);
R.is(r.square.centre[0] === 255 && r.square.centre[1] === 0 && r.square.layers === 1,
  `the stamp's centre carries the square's red, on the layer the stroke made (${rgb(r.square.centre)})`);
R.is(r.square.inEdge[0] === 255 && r.square.farLeft[0] === 255 && r.square.pastEdge[0] === 128,
  `the square's edge lands where the offset puts it: red at +15 and −15, grey at +25 (${rgb(r.square.inEdge)} / ${rgb(r.square.farLeft)} / ${rgb(r.square.pastEdge)})`);
R.is(r.square.outside[0] === 128, `a texel outside the brush is untouched (${rgb(r.square.outside)})`);
R.is(r.square.off && r.square.off.x === -200 && r.square.off.y === 0, `the first stamp fixed the offset (${JSON.stringify(r.square.off)})`);
console.log("-- aligned");
R.is(near(r.aligned.got, r.aligned.wantBase, 2) && Math.abs(r.aligned.got[0] - r.aligned.notBase[0]) > 40,
  `a second stroke copies from there + offset, not the source again: got ${rgb(r.aligned.got)}, base at the offset ${rgb(r.aligned.wantBase)}, under the brush ${rgb(r.aligned.notBase)}`);
console.log("-- no feedback");
R.is(near(r.feedback.got, r.feedback.want, 2) && Math.abs(r.feedback.got[0] - r.feedback.smear[0]) >= 40,
  `the stroke reads the pre-stroke sheet, even where its source crosses a tile it already wrote: got ${rgb(r.feedback.got)}, base(x − 200) ${rgb(r.feedback.want)}, the smear would be ${rgb(r.feedback.smear)}`);
console.log("-- match tone");
R.is(r.exact.beside[0] === 0x28 && r.exact.dot[0] === 255, `off, the copy is exact: the dot's dark surroundings come with it (${rgb(r.exact.beside)} / ${rgb(r.exact.dot)})`);
R.is(r.healed.beside[0] > 0xa0 && r.healed.beside[0] <= 0xd0 && r.healed.dot[0] === 255,
  `on, the copy is shifted to the tone under the brush: beside the dot ${rgb(r.healed.beside)} over a base of ${rgb(r.healed.light)}, the dot itself ${rgb(r.healed.dot)}`);
console.log("-- undo");
R.is(near(r.undo.back, r.undo.light, 0) && r.undo.redo, "undo takes the stroke off whole and redo puts it back");
console.log("-- the normal map");
R.is(r.normal.mode === "cloneN" && r.normal.got[0] === 0xc0 && r.normal.got[1] === 0x40 && r.normal.outside[0] === 0x80,
  `Clone normal copies the normal map onto a normal layer (${rgb(r.normal.got)} / ${rgb(r.normal.outside)}; layers: ${r.normal.layerChans.join(" | ")})`);
console.log("-- the panel");
R.is(r.panel.shown === "" && r.panel.hiddenForColour === "none", "the Clone's row shows for the Clone and not for the colour brush");
R.is(/Alt-click sets/.test(r.panel.noSrc) && /Source set/.test(r.panel.picked) && /follows/.test(r.panel.aligned),
  `and its hint follows the source's state: "${r.panel.noSrc}" → "${r.panel.picked}" → "${r.panel.aligned}"`);
R.is(r.refusal.smooth.err && /normal map/.test(r.refusal.smooth.err) && r.refusal.mask.err,
  `smoothness and the mask are refused in words: "${r.refusal.smooth.err}"`);

const errs = (r.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
