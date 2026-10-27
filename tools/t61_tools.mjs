// Every tool/channel/target pair either resolves or refuses in words (ROADMAP 4.28(d)).
//
// WHY THIS EXISTS. The nine-value `App.brush.mode` enum conflated what a gesture DOES with where it
// GOES, and the cost was not that the model was ugly — it was that the pairs the enum could not
// name had no behaviour at all. "The eraser on the smoothness channel" was not refused, it was
// unrepresentable, so the only possible answer was silence, and silence is what §4 of CLAUDE.md
// forbids. Splitting the axes only pays for itself if the newly-expressible pairs each say
// something, so that is what is asserted here: all 6 x 5 x 2 = 60 of them (5 x 5 x 2 until the Clone
// of 4.44 made it six tools and eleven modes), exhaustively, plus the
// two properties the rest of the app rests on —
//
//   * **the round trip.** Every legacy mode maps to a point and back to itself. Prefs, the
//     recorder, `BrushTools`' per-tool settings map and five other tests all still speak modes, and
//     they speak them through an accessor now; a point that named itself something else would move
//     a user's stored brush settings onto a different tool on the next launch.
//   * **the axes are the truth.** Writing `App.brush.mode` moves the three fields, writing a field
//     moves the mode, and an unknown mode moves nothing. The last one matters because `brush.mode`
//     is a saved preference: a string from an older build reaches that setter.
//
// It also asserts that `paintTarget` refuses rather than throws on every pair, against a real slot
// with a real layer stack — because "resolves in words" is only worth anything if the sentence
// actually reaches the user instead of a TypeError reaching the console.
//
// Usage: node tools/t61_tools.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = { pairs: [], round: [], axes: {}, paint: [] };
  var TOOLS = Object.keys(Tool.TOOLS);
  var CHANS = CHANNELS.map(function(c){ return c.id; });

  // ---- 1. all fifty pairs ----
  for (var i = 0; i < TOOLS.length; i++) for (var j = 0; j < CHANS.length; j++)
    for (var k = 0; k < 2; k++) {
      var tool = TOOLS[i], ch = CHANS[j], tgt = k ? "mask" : "content";
      var r = Tool.resolve(tool, ch, tgt);
      out.pairs.push({ tool: tool, ch: ch, target: tgt,
        mode: r.mode === undefined ? null : r.mode,
        err: r.err === undefined ? null : r.err,
        keys: Object.keys(r).sort().join(",") });
    }
  // A tool and a channel that do not exist at all, so the two guards at the top are exercised too.
  out.bogus = [Tool.resolve("hammer", "color", "content"), Tool.resolve("brush", "gloss", "content"),
               Tool.resolve("brush", "color", "sideways")];

  // ---- 2. every legacy mode round-trips through the axes ----
  var b = { tool: "brush", chan: "color", target: "content" };
  for (var m in Tool.MODES) {
    Tool.set(b, m);
    out.round.push({ mode: m, back: Tool.modeOf(b), tool: b.tool, chan: b.chan, target: b.target });
  }

  // ---- 3. App.brush.mode is a view of the three fields, in both directions ----
  var was = App.brush.mode;
  App.brush.mode = "smooth";
  out.axes.fromMode = { tool: App.brush.tool, chan: App.brush.chan, target: App.brush.target };
  App.brush.tool = "height"; App.brush.chan = "normal";
  out.axes.fromAxes = App.brush.mode;
  // The mask is a TARGET switch: it must not forget which channel you were working in, and putting
  // it down must put you back there. That is the whole reason the mask stops being a tool.
  App.brush.mode = "metal";
  App.brush.mode = "mask";
  out.axes.maskKeeps = { mode: App.brush.mode, chan: App.brush.chan, tool: App.brush.tool };
  App.brush.mode = "color";
  App.brush.mode = "nonesuch";
  out.axes.unknown = { mode: App.brush.mode, tool: App.brush.tool, chan: App.brush.chan };
  // The mask brush works on ANY channel, which the old enum could not say: mode "mask" with the
  // channel left on metalness is a legal point, and it is the one the user is standing on.
  App.brush.mode = "metal"; App.brush.target = "mask";
  out.axes.maskAnyChan = { mode: App.brush.mode, resolves: !!Tool.resolve(App.brush.tool, App.brush.chan, "mask").mode };
  App.brush.mode = was;

  // ---- 4. the derived table has not drifted from the one it is derived from ----
  out.brushChan = {};
  for (var m2 in BRUSH_CHAN) out.brushChan[m2] = BRUSH_CHAN[m2];

  // ---- 5. paintTarget answers every pair, against a real slot ----
  var N = 64;
  var mk = function(col){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = col; g.fillRect(0, 0, N, N); return c; };
  var slot = { id: "t61", layers: [], baseC: mk("#405060"), composite: mk("#405060"),
               smooth: mk("#303030"), metal: mk("#606060"), normal: mk("#8080ff") };
  var slotWas = App.activeSlot, layerWas = App.activeLayer, brushWas = App.brush.mode;
  App.activeSlot = slot;
  // One colour paint layer selected — the ordinary case, and the one where most pairs are the
  // wrong tool for the layer in hand rather than an impossible pair.
  var L = LayerNode.of({ type: "paint", name: "Paint 1", canvas: mkCanvas(N, N),
                         visible: true, opacity: 1, blend: "normal" });
  slot.layers.push(L);
  App.activeLayer = L;
  for (var i2 = 0; i2 < TOOLS.length; i2++) for (var j2 = 0; j2 < CHANS.length; j2++)
    for (var k2 = 0; k2 < 2; k2++) {
      var tool2 = TOOLS[i2], ch2 = CHANS[j2], tgt2 = k2 ? "mask" : "content";
      App.brush.tool = tool2; App.brush.chan = ch2; App.brush.target = tgt2;
      var rec = { tool: tool2, ch: ch2, target: tgt2 };
      try {
        var t = paintTarget();
        // needSlot arrived with 4.28(e): a layer IS selected and simply carries nothing on this
        // channel, so the answer is "make the slot inside it", one level below "make a layer".
        rec.kind = !t ? "null" : t.err ? "err" : t.need ? "need" : t.needSlot ? "needSlot" : t.canvas ? "canvas" : "other";
        rec.err = t && t.err ? t.err : null;
      } catch (e) { rec.kind = "throw"; rec.err = String(e && e.message || e); }
      out.paint.push(rec);
    }
  // ---- 6. the tool row's ENABLEMENT is a function of what can be written ----
  // ROADMAP 4.40. A slot exists from the model rebind before its textures have decoded, so the
  // panel is refreshed once while slot.smooth is still null — every surface tool correctly
  // disabled — and then completeSlots late-binds the _n on the NEXT rebuildAll. That second pass
  // never refreshed the panel (it calls selectSlot only when nothing is selected yet), so the
  // surface tools stayed dead until setPaint3d(true) happened to call the refresher. Hence the
  // report: "the brush type cannot be changed away from colour until the brush is switched on".
  var paintWas = App.paint3d;
  var state = function(){
    var o = {};
    document.querySelectorAll("#brushModes [data-bm]").forEach(function(b){
      o[b.dataset.bm] = { off: !!b.disabled, hidden: b.style.display === "none", why: b.dataset.why || "" };
    });
    return o;
  };
  var s6 = { id: "t61c", layers: [], baseC: mk("#405060"), composite: mk("#405060"),
             smooth: null, metal: null, normal: null, missing: false, size: N, sizeH: N };
  App.slots.set(s6.id, s6);
  App.activeSlot = s6; App.activeLayer = null;
  App.paint3d = false;
  updateBrushAvailability();
  out.enable = { noN: state() };
  // The _n arrives — the way completeSlots binds one onto a slot that already existed — and the
  // load funnel finishes. Nothing touches the painting switch.
  s6.smooth = mk("#303030"); s6.metal = mk("#606060"); s6.normal = mk("#8080ff");
  rebuildAll();
  out.enable.afterLoad = state();
  // ...and the same state with painting ON must read identically: the switch is not an input here.
  App.paint3d = true;
  updateBrushAvailability();
  out.enable.painting = state();
  App.slots.delete(s6.id);
  App.paint3d = paintWas;
  App.activeSlot = slotWas; App.activeLayer = layerWas; App.brush.mode = brushWas;
  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY), keep: argv.includes("--keep") });
if (!r.ok) { console.log("FAILED to evaluate: " + JSON.stringify(r).slice(0, 400)); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("threw in page:" + String.fromCharCode(10) + o.__threw); process.exit(1); }

console.log("=== every tool x channel x target pair says something ===");
const bad = o.pairs.filter(p => !p.mode && !p.err);
const both = o.pairs.filter(p => p.mode && p.err);
const resolved = o.pairs.filter(p => p.mode);
const refused = o.pairs.filter(p => p.err);
console.log(`   ${o.pairs.length} pairs · ${resolved.length} resolve · ${refused.length} refuse`);
for (const p of refused.slice(0, 4)) console.log(`     ${p.tool} x ${p.ch} x ${p.target}: ${p.err}`);
R.is(o.pairs.length === 70, `all 7 tools x 5 channels x 2 targets were walked (${o.pairs.length})`);
R.is(bad.length === 0,
  bad.length ? `silent pairs — neither a mode nor a message: ${bad.map(p => p.tool + "/" + p.ch + "/" + p.target).join(", ")}`
             : "every pair answers with either a mode or a sentence — none is silent, which is the whole point of splitting the axes");
R.is(both.length === 0, both.length ? `pairs answering twice: ${both.map(p => p.tool + "/" + p.ch).join(", ")}` : "and none answers with both");
R.is(refused.every(p => p.err.length > 25 && /[.]$/.test(p.err)),
  "every refusal is a sentence rather than a token — it is shown to the user verbatim");
R.is(refused.every(p => p.keys === "err") && resolved.every(p => p.keys === "mode"),
  "a result carries exactly one key, so `if (r.err)` and `if (r.mode)` cannot both be taken");

// The shape of the space, stated rather than counted: it is what changed, so it is what a
// regression would move.
const modes = new Set(resolved.map(p => p.mode));
R.is(modes.size === 12 && [...modes].sort().join(",") === "clone,cloneN,color,erase,flatten,height,mask,metal,none,retouch,smooth,wear",
  `the resolving pairs cover the nine legacy modes, the Clone's two and the Retouch brush's one (4.50 (11)), and no thirteenth (${[...modes].sort().join(",")})`);
R.is(o.pairs.filter(p => p.tool === "none").every(p => p.mode === "none"),
  "no tool resolves everywhere — painting being off is not an error to report on every channel");
R.is(o.pairs.filter(p => p.tool === "brush" && p.target === "mask").every(p => p.mode === "mask") &&
     o.pairs.filter(p => p.tool === "brush" && p.target === "mask").length === 5,
  "the Brush reaches a mask on every one of the five channels — the mask is a target, not a channel of its own");
for (const t of ["eraser", "height", "flatten", "retouch"])
  R.is(o.pairs.filter(p => p.tool === t && p.target === "mask").every(p => p.err && /mask/.test(p.err)),
    `${t} on a mask refuses and says why (${(o.pairs.find(p => p.tool === t && p.target === "mask") || {}).err})`);
R.is(o.bogus.every(x => x.err && !x.mode), "an unknown tool, channel or target is refused by name rather than assumed");

console.log("\n=== the legacy nine round-trip through the axes ===");
for (const x of o.round) console.log(`   ${x.mode.padEnd(8)} -> ${x.tool} / ${x.chan} / ${x.target} -> ${x.back}`);
R.is(o.round.every(x => x.back === x.mode),
  "every mode maps to a point and back to itself — prefs, the recorder and BrushTools all key off these strings, and a point naming itself something else would move a user's stored settings onto a different tool");
R.is(o.round.length === 12, `all twelve (${o.round.length})`);

console.log("\n=== App.brush.mode is a view of the three fields ===");
console.log("   " + JSON.stringify(o.axes));
R.is(o.axes.fromMode.tool === "brush" && o.axes.fromMode.chan === "smooth" && o.axes.fromMode.target === "content",
  "setting the mode moves all three axes");
R.is(o.axes.fromAxes === "height", "and setting the axes moves the mode");
R.is(o.axes.maskKeeps.mode === "mask" && o.axes.maskKeeps.chan === "metal",
  `picking up the mask brush keeps the channel you were working in (${o.axes.maskKeeps.chan}) — it switches the target, so putting it down puts you back where you were`);
R.is(o.axes.unknown.mode === "color" && o.axes.unknown.tool === "brush",
  `an unknown mode changes nothing (still ${o.axes.unknown.mode}) — brush.mode is a saved preference, so a string from an older build reaches this setter`);
R.is(o.axes.maskAnyChan.mode === "mask" && o.axes.maskAnyChan.resolves,
  "the mask brush is legal on a non-colour channel, which the old enum had no way to express");

R.is(JSON.stringify(o.brushChan) === JSON.stringify({ wear: "wear", smooth: "smooth", metal: "metal", flatten: "normal", height: "normal", cloneN: "normal" }),
  `BRUSH_CHAN is still the table it was, derived from MODES rather than written out twice (${JSON.stringify(o.brushChan)})`);

console.log("\n=== paintTarget answers every pair against a real slot ===");
const threw = o.paint.filter(p => p.kind === "throw");
const silent = o.paint.filter(p => p.kind === "null" || p.kind === "other");
console.log(`   ${o.paint.length} pairs · ${o.paint.filter(p => p.kind === "canvas").length} give a canvas · ` +
  `${o.paint.filter(p => p.kind === "need").length} ask for a layer · ${o.paint.filter(p => p.kind === "needSlot").length} ask for a channel · ` +
  `${o.paint.filter(p => p.kind === "err").length} refuse`);
for (const p of threw.slice(0, 5)) console.log(`     THREW ${p.tool} x ${p.ch} x ${p.target}: ${p.err}`);
R.is(threw.length === 0, threw.length ? `${threw.length} pairs threw instead of refusing` : "no pair throws — a refusal reaches the user as a message, not the console as a TypeError");
R.is(silent.length === 0, silent.length ? `${silent.length} pairs answered with nothing at all` : "and no pair answers with nothing");
R.is(o.paint.filter(p => p.kind === "err").every(p => p.err && p.err.length > 15),
  "every paintTarget refusal is a sentence too");
const colour = o.paint.find(p => p.tool === "brush" && p.ch === "color" && p.target === "content");
R.is(colour && colour.kind === "canvas",
  "the ordinary case still works: the Brush on colour, with a colour paint layer selected, hands back its canvas");
// Until 4.28(e) this refused: a layer wrote one channel, so the Brush on metalness over a colour
// layer was "the wrong tool for this layer" and said so. A layer is a bundle of per-channel content
// now and a tool addresses its OWN slot in it, so the same pair asks for that slot to be made —
// inside the layer the user chose, not as a second layer beside it. The assertion is inverted
// rather than deleted, because "it stopped refusing" and "it silently does nothing" look identical
// from the outside and only one of them is the intended change.
const wrongChan = o.paint.find(p => p.tool === "brush" && p.ch === "metal" && p.target === "content");
R.is(wrongChan && wrongChan.kind === "needSlot",
  `the Brush on metalness over a COLOUR layer asks for a metalness channel IN that layer (${wrongChan && wrongChan.kind}) — it no longer refuses, because the layer can carry one`);

console.log("\n=== the tool row is enabled by what can be written, not by the paint switch ===");
const en = o.enable;
console.log("   no _n:      " + Object.keys(en.noN).filter(k => en.noN[k].off).join(", ") + " disabled");
console.log("   after load: " + (Object.keys(en.afterLoad).filter(k => en.afterLoad[k].off).join(", ") || "none") + " disabled");
R.is(en.noN.smooth.off && /_n/.test(en.noN.smooth.why),
  "with no _n on the slot the four surface tools are disabled and say why — that part was always right");
const live = ["smooth", "metal", "height", "flatten"].filter(k => !en.afterLoad[k].off);
R.is(live.length === 4,
  live.length === 4
    ? "once the _n has arrived and the load funnel has finished, all four surface tools are live — with the painting switch never touched (4.40: they used to stay dead until setPaint3d happened to call the refresher)"
    : `the surface tools are still disabled after the load finished — only ${live.join(", ") || "none"} came back (ROADMAP 4.40)`);
R.is(JSON.stringify(en.afterLoad) === JSON.stringify(en.painting),
  "and turning painting ON changes not one button — whether you are painting is not an input to what a tool can write");

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
