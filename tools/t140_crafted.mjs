// A project file is input from anywhere, so every field the project readers take from one is held to
// the shape this build reads — one crafted record per field, through the real readers, in the page.
//
// WHY THIS EXISTS. Anyone's .wtproj opens as easily as one's own, and a .wtstack is the same reader.
// The review of 2026-10-10 forced blend, colour and the adjustment numbers to their shapes in ProjNode,
// because panels put them into markup; everything else still came in as it was written. Measured on
// the page (2026-10-17), that was:
//   * a channel's NAME is markup wherever it has no label of its own (`CHAN_LABEL[ch] || ch`), so a
//     crafted key became an element in the layer panel — through a version 5 leaf's slots, a
//     version 4 record's `chan`, and the weapon merge;
//   * the weapon merge (game/weapon-skin.js) reads a .wtproj without ProjNode at all, so its blend
//     and fill colour still reached the markup that review closed;
//   * a decal's or a projection's scale, or a projection's depth, as a string threw out of the whole
//     layer panel (`toFixed`); a mirrored copy that is not an object threw from a group nudge; a
//     projection whose parts are not a list threw from every edit's undo snapshot, and one with no
//     frame could not be edited at all; a depth image named in the record was believed;
//   * a blend-if band of non-numbers hid its layer everywhere (a NaN band, sliders at "NaN%"); a Look
//     that is a string took no outline edit; an outline of 1e6 % threw "Out of memory at ImageData
//     creation" out of the compositor (1e5 %: a 20012² canvas and 8.3 s of one composite); opacities
//     outside 0…1, or not numbers, were kept and written back;
//   * a text record that is not an object turned a picture into an "Edit text…" decal, and a font id
//     that is not one went into the font list of every save.
// Two are held as harmless rather than changed: an effect of a kind this build does not know is kept
// as it came — it draws nothing, its kind is shown escaped, and it survives a save — and a text
// record's other fields reach no markup (the dialog builds its controls) and are normalised on use.
//
// The last case holds the other side of it: a node with every field set the way this build writes
// them comes back from a save and a load byte for byte, so nothing real was changed on the way in.
//
// Usage: node tools/t140_crafted.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {}, N = 64;
  // An element in text and a break out of a double-quoted attribute, so either kind of interpolation
  // leaves an element carrying data-crafted behind.
  var PAY = function(t){ return '"><b data-crafted="' + t + '"></b>'; };
  var marked = function(){
    var els = document.querySelectorAll("[data-crafted]"), got = [];
    for (var i = 0; i < els.length; i++) { got.push(els[i].getAttribute("data-crafted")); els[i].remove(); }
    return got;
  };
  var why = function(e){ return String(e && e.name) + ": " + String(e && e.message); };
  var threw = function(f){ try { f(); return null; } catch (e) { return why(e); } };
  var tiny = function(){ var c = mkCanvas(8, 8), g = ctx2d(c); g.fillStyle = "#ff0000"; g.fillRect(2, 2, 4, 4); return c; };
  var rctx = function(){ return { img: async function(){ return tiny(); }, shared: new Map(), seq: 0 }; };
  var wctx = function(){ var n = 0; return { put: async function(){ return "f" + (n++) + ".png"; }, heights: new Map() }; };
  // In as a file is: JSON text, so 1e999 is how a file says Infinity and NaN cannot be in one at all.
  var load = async function(rec){ return ProjNode.load(JSON.parse(typeof rec === "string" ? rec : JSON.stringify(rec)), rctx()); };
  var grey = function(){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = "#808080"; g.fillRect(0, 0, N, N); return c; };
  var img = function(o){ var c = { kind: "image", bmpFile: "b", x: .5, y: .5, scale: 1, rot: 0, flip: false }; for (var k in o) c[k] = o[k]; return c; };
  var leaf = function(name, chans, more){ var L = { name: name, visible: true, opacity: 1, blend: "normal", chans: chans }; for (var k in more || {}) L[k] = more[k]; return L; };
  var s = { id: "t140", size: N, nSize: N, layers: [], missing: false };
  s.baseC = grey(); s.composite = grey();
  App.slots.set("t140", s);
  var was = { slot: App.activeSlot, layer: App.activeLayer };
  App.activeSlot = s;
  out.brushChan = App.brush.chan;
  // The node alone on the slot, selected, and every panel that follows the selection built for it.
  // \`list: false\` skips the layer list, whose thumbnails would draw a styled decal.
  var show = function(L, list){
    s.layers = [L]; App.activeLayer = L;
    return threw(function(){ if (list !== false) refreshLayerList(); refreshLayerProps(); });
  };
  var px = function(){ compositeSlot(s); flushComposites(); return Array.prototype.slice.call(ctx2d(s.composite).getImageData(N / 2, N / 2, 1, 1).data, 0, 3); };

  // ---- A. a channel's name ----
  var ch = {}; ch[PAY("chan5")] = { kind: "fill", color: "#ffffff" }; ch.smooth = { kind: "fill", color: "#404040" };
  var A = await load(leaf("A", ch));
  out.A = { chans: LayerNode.channelsOf(A), threw: show(A), marked: marked() };
  var A2 = await load(leaf("A2", { emissive: { kind: "fill", color: "#ffffff" }, color: "not a content" }));
  out.A2 = { chans: LayerNode.channelsOf(A2), threw: show(A2), comp: threw(px) };
  var A3 = await load({ type: "fill", name: "A3", visible: true, opacity: 1, blend: "normal", chan: PAY("chan4"), color: "#ffffff" });
  out.A3 = { chans: LayerNode.channelsOf(A3), threw: show(A3), marked: marked() };

  // ---- B. a floating decal's placement ----
  var B = await load(leaf("B", { color: img({ x: "0.25", y: null, scale: "2", rot: "spin", flip: "no", sym: "mirror", surf: "vinyl" }) }));
  var Bc = B.chans.color;
  out.B = { x: Bc.x, y: Bc.y, scale: Bc.scale, rot: Bc.rot, flip: Bc.flip, sym: Bc.sym, surf: Bc.surf, threw: show(B) };
  out.B.style = threw(function(){ StyleUI.input("ol", 3); StyleUI.commit("decal outline"); });
  out.B.ol = (surfOf(B) || {}).ol;
  var B2 = await load('{"name":"B2","visible":true,"opacity":1,"blend":"normal","chans":{"color":{"kind":"image","bmpFile":"b","x":1e999,"y":0.5,"scale":-3,"rot":1e999,"flip":0,"sym":{"x":"0.75","y":1e999,"k":1}}}}');
  var B2c = B2.chans.color;
  out.B2 = { x: B2c.x, scale: B2c.scale, rot: B2c.rot, flip: B2c.flip, sym: B2c.sym };
  var G = await load({ type: "group", name: "G", visible: true, opacity: 1, blend: "normal", children: [
    leaf("d1", { color: img({}) }), leaf("d2", { color: img({ x: "0.5", sym: "mirror" }) }) ] });
  s.layers = [G];
  out.B3 = { threw: threw(function(){ moveDecalSiblings(s, G.children[0], .01, 0); }), x: G.children[1].chans.color.x };

  // ---- C. a decal's Look ----
  var C = await load(leaf("C", { color: img({ surf: { sm: "x", mt: null, ol: 1e6, olc: PAY("olc"), sh: "50", shx: "a", shy: -4, shb: 1e6, shc: 7,
                                                     preset: "vinyl", relief: "edge", later: "kept" } }) }));
  var Cc = C.chans.color, pad = DecalStyle.pad(Cc.bmp, DecalStyle.read(Cc.surf), true);
  out.C = { surf: Cc.surf, side: Cc.bmp.width + 2 * pad, threw: show(C, false), marked: marked() };

  // ---- D. opacity: a group's, a layer's and a content's, in both shapes of record ----
  var D = await load('{"type":"group","name":"D","visible":true,"opacity":"half","blend":"normal","children":[' +
    '{"name":"d","visible":true,"opacity":5,"blend":"normal","chans":{"color":{"kind":"fill","color":"#ffffff","opacity":1e999},"smooth":{"kind":"fill","color":"#ffffff","opacity":-1}}},' +
    '{"type":"fill","name":"d4","visible":true,"opacity":"0.5","blend":"normal","color":"#ffffff"}]}');
  var d = D.children[0];
  out.D = { group: D.opacity, leaf: d.opacity, c1: d.chans.color.opacity, c2: d.chans.smooth.opacity, legacy: D.children[1].opacity };

  // ---- E. blend-if ----
  var E = await load(leaf("E", { color: { kind: "fill", color: "#ffffff" } }, { tone: { src: "x", lo: "abc", hi: "zz", soft: null, invert: 0, color: PAY("tone") } }));
  s.layers = [E];
  out.E = { tone: E.tone, px: px(), threw: show(E), marked: marked() };
  var E2 = await load({ type: "group", name: "E2", visible: true, opacity: 1, blend: "normal", children: [], tone: "abc" });
  out.E2 = { tone: E2.tone === undefined ? "absent" : E2.tone };

  // ---- F. an effect of a kind this build does not know, and a record that cannot exist ----
  var F = await load(leaf("F", { color: { kind: "effect", hue: 0, sat: 100, bright: 100, contrast: 100, fx: { type: PAY("fx"), rgb: PAY("fxrgb"), later: [1, 2] } } }));
  s.layers = [F];
  var Fpx = px(), Fsaved = await ProjNode.save(F, wctx());
  out.F = { fx: F.chans.color.fx, px: Fpx, saved: Fsaved.chans.color.fx, threw: show(F), marked: marked() };
  out.F.said = Array.prototype.map.call(document.querySelectorAll("#layerProps option"), function(o){ return o.textContent; })
    .filter(function(t){ return /newer version/.test(t); });
  var F2 = await load(leaf("F2", { color: { kind: "effect", hue: 0, sat: 100, bright: 200, contrast: 100, fx: { type: "hsbc" } } }));
  s.layers = [F2];
  out.F2 = { fx: F2.chans.color.fx === undefined ? "absent" : F2.chans.color.fx, px: px() };

  // ---- LV. which mip levels a node shows at (4.58, version 7): three integers 0–15, whatever the file says ----
  var fillC = { color: { kind: "fill", color: "#00ff00" } };
  var M1 = await load('{"name":"M1","visible":true,"opacity":1,"blend":"normal","chans":{"color":{"kind":"fill","color":"#00ff00"}},' +
                      '"levels":{"from":"3","to":1e999,"soft":-2,"later":' + JSON.stringify(PAY("lv")) + '}}');
  var M2 = await load(leaf("M2", fillC, { levels: [1, 2, 3] }));
  var M3 = await load({ type: "group", name: "M3", visible: true, opacity: 1, blend: "normal", children: [], levels: { from: PAY("from"), to: 2.6, soft: 99 } });
  var M4 = await load(leaf("M4", fillC, { levels: { from: 0, to: 15, soft: 3 } }));
  var M5 = await load(leaf("M5", fillC, { levels: "far" }));
  out.LV = { m1: M1.levels, m2: M2.levels === undefined ? "absent" : M2.levels, m3: M3.levels,
            m4: M4.levels === undefined ? "absent" : M4.levels, m5: M5.levels === undefined ? "absent" : M5.levels,
            threw: show(M1), threw3: show(M3), marked: marked() };

  // ---- G. a text decal's record ----
  var T1 = await load(leaf("T1", { color: img({ text: "abc" }) }));
  var T2 = await load(leaf("T2", { color: img({ text: { string: PAY("str"), font: PAY("font"), fontId: 'ab"c', size: "huge", colour: PAY("col"), later: { a: 1 } } }) }));
  out.G = { t1: T1.chans.color.text === undefined ? "absent" : T1.chans.color.text, t2: T2.chans.color.text,
            ids: Array.from(TextDecal.fontIds([T2])), threw: show(T2), marked: marked() };
  show(T1);
  out.G.button = $("btnDecalEditor").textContent;

  // ---- H. a projected decal's parameters ----
  var bad = { id: { o: 1 }, frame: "nowhere", scale: "2", rot: "r", depth: "deep", wrap: 9, parts: 5, name: 7, surf: "s", text: 3, heightMap: "evil", flip: "no" };
  var H = await load(leaf("H", { color: { kind: "paint", canvasFile: "c", proj: bad, projFile: "p" } }));
  out.H = { proj: H.chans.color.proj ? Object.keys(H.chans.color.proj) : null, kind: H.chans.color.kind, canvas: !!H.chans.color.canvas, threw: show(H) };
  var frame = { p: [0, 0, 0], n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] };
  var H2 = await load(leaf("H2", { color: { kind: "paint", canvasFile: "c", proj: Object.assign({}, bad, { id: "p9", frame: frame, _styled: "x" }), projFile: "p" } }));
  var P2 = H2.chans.color.proj || {};
  out.H2 = { scale: P2.scale, rot: P2.rot, depth: P2.depth, wrap: P2.wrap, parts: P2.parts, name: P2.name === undefined ? "absent" : P2.name,
             surf: P2.surf, text: P2.text === undefined ? "absent" : P2.text, heightMap: typeof P2.heightMap, flip: P2.flip, styled: P2._styled === undefined ? "absent" : P2._styled,
             bmp: !!(P2.bmp && P2.bmp.width), threw: show(H2), snap: threw(function(){ projParamsClone(P2); }) };

  // ---- M. the weapon merge, the second reader of the same file ----
  var mz = new JSZip();
  mz.file("project.json", JSON.stringify({ app: "wt-skin-studio", version: 4, skinName: "crafted", slots: [{ id: "T140", layers: [
    { type: "fill", name: "m1", visible: true, opacity: 1, blend: PAY("mblend"), color: PAY("mcolor") },
    { type: "fill", name: "m2", visible: true, opacity: "x", blend: "normal", chan: PAY("mchan"), color: "#ffffff" },
    { type: "adjust", name: "m3", visible: true, opacity: 1, blend: "normal", hue: PAY("mhue"), sat: 100, bright: 100, contrast: 100 },
    { type: "decal", name: "m4", visible: true, opacity: 1, blend: "normal", bmpFile: "b.png", x: "0.5", y: .5, scale: "2", rot: 0, flip: false } ] }] }));
  mz.file("b.png", await canvasBlob(tiny()));
  s.layers = [];
  var mthrew = null;
  try { await mergeProjectLayers(await mz.generateAsync({ type: "blob" })); } catch (e) { mthrew = why(e); }
  var byName = function(n){ return layerLeaves(s.layers).filter(function(l){ return l.name === n; })[0]; };
  var m1 = byName("m1"), m2 = byName("m2"), m3 = byName("m3"), m4 = byName("m4"), merged = s.layers.slice();
  out.M = { threw: mthrew, got: [!!m1, !!m2, !!m3, !!m4], blend: m1 && m1.blend, color: m1 && m1.color, chans2: m2 && LayerNode.channelsOf(m2),
            opacity2: m2 && m2.opacity, hue3: m3 && m3.hue, scale4: m4 && m4.scale };
  // each panel's injections are counted before the next one is built, which empties the panel first
  out.M.panels = merged.map(function(L){ s.layers = merged; App.activeLayer = L; var t = threw(function(){ refreshLayerProps(); }); return { threw: t, marked: marked() }; });

  // ---- Z. what the review of 2026-10-10 forced, which no test had held: a blend, a colour, an effect's numbers ----
  var Z1 = await load(leaf("Z1", { color: { kind: "fill", color: PAY("zcolor") } }, { blend: PAY("zblend") }));
  out.Z = { blend: Z1.blend, color: Z1.chans.color.color, threw: show(Z1), marked: marked() };
  var Z2 = await load(leaf("Z2", { color: { kind: "effect", hue: PAY("zhue"), sat: "x", bright: 100, contrast: 100 } }));
  out.Z.hue = Z2.chans.color.hue; out.Z.sat = Z2.chans.color.sat; out.Z.threw2 = show(Z2); out.Z.marked2 = marked();

  // ---- L. everything this build writes comes back exactly ----
  var look = { sm: 55, mt: 0, em: 6, wr: 0, preset: "vinyl", ol: 150, olc: "#ff0000", sh: 40, shx: -4, shy: 4, shb: 3, shc: "#000000",
               relief: "bevel", bevel: 8, heightInv: true, heightFrom: "depth", glossSrc: "light", cavity: 20 };
  var text = TextDecal.norm({ string: "AB 12", font: "serif", size: 96 });
  var dec = LayerNode.of({ type: "decal", name: "dec", visible: true, opacity: .75, blend: "multiply", bmp: tiny(), x: .3, y: .7, scale: 1.5, rot: 30, flip: true,
                           sym: { x: .7, y: .7 }, surf: Object.assign({}, look), text: Object.assign({}, text) });
  dec.chans.color.opacity = .5;
  dec.tone = { src: "color", color: "#123456", lo: .2, hi: .9, soft: .1, invert: true };
  var P = { id: "p1", frame: { p: [1, 2, 3], n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] }, bmp: tiny(), scale: 1.25, rot: -15, flip: true, sym2: true, sym2Read: true,
            name: "roundel", parts: ["body", "wing_l"], surf: Object.assign({}, look), depth: 2.5, wrap: .6, text: Object.assign({}, text) };
  var pj = LayerNode.of({ type: "paint", name: "Proj: roundel", visible: true, opacity: 1, blend: "normal", canvas: tiny(), proj: P });
  var fx = LayerNode.of({ type: "adjust", name: "fx", visible: false, opacity: .4, blend: "screen", hue: 0, sat: 100, bright: 100, contrast: 100 });
  fx.chans.color.fx = Effect.make("levels"); fx.chans.color.fx.rgb.gamma = 1.4;
  dec.levels = Levels.make(0, 2, 1);
  var grp = Object.assign(newGroupNode("grp"), { opacity: .7, blend: "pass through", collapsed: true, children: [dec, pj, fx],
                                                 tone: { src: "lum", lo: 0, hi: .5, soft: .2, invert: false }, levels: Levels.far(4) });
  var first = await ProjNode.save(grp, wctx());
  var again = await ProjNode.save(await ProjNode.load(JSON.parse(JSON.stringify(first)), rctx()), wctx());
  out.L = { same: JSON.stringify(first) === JSON.stringify(again), bytes: JSON.stringify(first).length };
  if (!out.L.same) { out.L.first = JSON.stringify(first); out.L.again = JSON.stringify(again); }

  App.slots.delete("t140"); App.activeSlot = was.slot; App.activeLayer = was.layer;
  threw(function(){ refreshLayerList(); refreshLayerProps(); });
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 300), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }
const J = v => JSON.stringify(v);
const none = (list, what) => !list || !list.length ? what : what + " — but the page grew " + J(list);

console.log("=== A. a channel's name ===");
R.is(r.brushChan === "color", `the brush is on colour (${r.brushChan}), so a layer's own first channel is the one the panel shows`);
R.is(J(r.A.chans) === J(["smooth"]) && !r.A.threw && !r.A.marked.length,
  none(r.A.marked, `a version 5 slot under a channel name this build does not have is not kept, and the panel shows the one that is: ${J(r.A.chans)}`) + (r.A.threw ? " · threw " + r.A.threw : ""));
R.is(J(r.A2.chans) === J([]) && !r.A2.threw && !r.A2.comp,
  `a layer left with nothing it can draw still lists, shows and composites (${J(r.A2.chans)})` + (r.A2.threw || r.A2.comp ? " · threw " + (r.A2.threw || r.A2.comp) : ""));
R.is(J(r.A3.chans) === J(["color"]) && !r.A3.threw && !r.A3.marked.length,
  none(r.A3.marked, `a version 4 record's unknown \`chan\` reads as colour, the default it always had: ${J(r.A3.chans)}`) + (r.A3.threw ? " · threw " + r.A3.threw : ""));

console.log("\n=== B. a floating decal's placement ===");
R.is(r.B.x === .25 && r.B.y === .5 && r.B.scale === 2 && r.B.rot === 0 && r.B.flip === true && r.B.sym === null && r.B.surf === null,
  `numbers that are numbers, a flag that is a flag, no mirror and no Look where the file had neither: ${J({ x: r.B.x, y: r.B.y, scale: r.B.scale, rot: r.B.rot, flip: r.B.flip, sym: r.B.sym, surf: r.B.surf })}`);
R.is(!r.B.threw, "the layer panel builds for it" + (r.B.threw ? " — threw " + r.B.threw : ""));
R.is(!r.B.style && r.B.ol === 3, `the outline slider writes into its Look (outline ${r.B.ol})` + (r.B.style ? " — threw " + r.B.style : ""));
R.is(r.B2.x === .5 && r.B2.scale === 1 && r.B2.rot === 0 && r.B2.flip === false && J(r.B2.sym) === J({ x: .75, y: .5 }),
  `Infinity, a scale below zero and a mirror with a string in it come back as a placement: ${J(r.B2)}`);
R.is(!r.B3.threw && Math.abs(r.B3.x - .51) < 1e-9, `nudging a decal moves its group sibling, whose mirror was not an object (${r.B3.x})` + (r.B3.threw ? " — threw " + r.B3.threw : ""));

console.log("\n=== C. a decal's Look ===");
const S = r.C.surf || {};
R.is(S.sm === 0 && S.mt === 0 && S.sh === 50 && S.shx === 0 && S.shy === -4 && S.olc === "#808080" && S.shc === "#808080",
  `its numbers are numbers and its colours are colours: ${J(S)}`);
R.is(S.ol === 1e6 && S.shb === 1e6 && S.preset === "vinyl" && S.relief === "edge" && S.later === "kept",
  "…and nothing else is rewritten — the widths, the preset, the relief and a key from a later build stay as they came");
R.is(r.C.side <= 8192, `drawn, its outline and shadow are bounded where the pixels are made: an 8-px decal's styled side is ${r.C.side} px`);
R.is(!r.C.threw && !r.C.marked.length, none(r.C.marked, "the decal's panels build for it") + (r.C.threw ? " — threw " + r.C.threw : ""));

console.log("\n=== D. opacity ===");
R.is(J(r.D) === J({ group: 1, leaf: 1, c1: 1, c2: 0, legacy: .5 }),
  `every opacity is a number from 0 to 1 — a word and Infinity read as the default, 5 and −1 as the nearest end: ${J(r.D)}`);

console.log("\n=== E. blend-if ===");
R.is(J(r.E.tone) === J({ src: "lum", lo: 0, hi: 1, soft: 0, invert: false, color: "#808080" }), `the band is six numbers and a source: ${J(r.E.tone)}`);
R.is(J(r.E.px) === J([255, 255, 255]), `…so it shows the layer over every tone, instead of hiding it everywhere (${J(r.E.px)})`);
R.is(!r.E.threw && !r.E.marked.length, none(r.E.marked, "its rows build") + (r.E.threw ? " — threw " + r.E.threw : ""));
R.is(r.E2.tone === "absent", `a group's band that is not a record is no band (${J(r.E2.tone)})`);

console.log("\n=== F. effects ===");
R.is(r.F.fx && r.F.fx.type === '"><b data-crafted="fx"></b>' && J(r.F.saved) === J(r.F.fx),
  "an effect of a kind this build does not know is kept exactly as it came, and saved that way");
R.is(J(r.F.px) === J([128, 128, 128]), `…draws nothing (${J(r.F.px)})`);
R.is(!r.F.threw && !r.F.marked.length && r.F.said.length === 1 && r.F.said[0].indexOf('data-crafted="fx"') >= 0,
  none(r.F.marked, `…and its kind is named in the panel as text: ${J(r.F.said)}`) + (r.F.threw ? " — threw " + r.F.threw : ""));
R.is(r.F2.fx === "absent" && r.F2.px[0] > 128, `an "hsbc" record, which this build never writes, is the four numbers it stands for (no record, ${J(r.F2.px)})`);

console.log("\n=== LV. which mip levels a node shows at (4.58) ===");
R.is(J(r.LV.m1) === J({ from: 3, to: 15, soft: 0 }), `a range is three integers held to 0–15: "3", Infinity and −2 read as ${J(r.LV.m1)}, and a key it does not have is dropped`);
R.is(r.LV.m2 === "absent" && r.LV.m5 === "absent", "an array or a string is no range — the node shows at every level");
R.is(J(r.LV.m3) === J({ from: 0, to: 3, soft: 15 }), `a group's too: markup for a level, 2.6 and 99 read as ${J(r.LV.m3)}`);
R.is(r.LV.m4 === "absent", "a range covering every level is no range at all");
R.is(!r.LV.threw && !r.LV.threw3 && !r.LV.marked.length, none(r.LV.marked, "and the Shows at row puts nothing of it into the panel") + (r.LV.threw ? " — threw " + r.LV.threw : ""));

console.log("\n=== G. a text decal's record ===");
R.is(r.G.t1 === "absent" && !/text/i.test(r.G.button), `a record that is not an object is no text — the decal edits as a picture ("${r.G.button}")`);
const t2 = r.G.t2 || {};
R.is(t2.fontId === null && t2.size === "huge" && t2.colour === '"><b data-crafted="col"></b>' && J(t2.later) === J({ a: 1 }) && J(r.G.ids) === J([]),
  `its font id is an id or none (${J(t2.fontId)}), so no save looks for that file — the rest is kept as it came, for the editor to normalise`);
R.is(!r.G.threw && !r.G.marked.length, none(r.G.marked, "its string, font and colour reach no markup") + (r.G.threw ? " — threw " + r.G.threw : ""));

console.log("\n=== H. a projected decal's parameters ===");
R.is(r.H.proj === null && r.H.kind === "paint" && r.H.canvas && !r.H.threw,
  `a projection with no frame comes back as the pixels it painted, the way a .wtstack flattens one (${J(r.H.proj)})` + (r.H.threw ? " — threw " + r.H.threw : ""));
const P2 = r.H2;
R.is(P2.scale === 2 && P2.rot === 0 && P2.depth === 3 && P2.wrap === 1 && P2.parts === null && P2.name === "absent" && P2.surf === null && P2.text === "absent" && P2.flip === true,
  `with a frame, the rest is held to its shape: ${J({ scale: P2.scale, rot: P2.rot, depth: P2.depth, wrap: P2.wrap, parts: P2.parts, name: P2.name, surf: P2.surf, text: P2.text, flip: P2.flip })}`);
R.is(P2.heightMap === "undefined" && P2.styled === "absent" && P2.bmp,
  `a depth image or a cached copy named in the record is not believed — only the file's own images are (${P2.heightMap}, ${P2.styled})`);
R.is(!P2.threw && !P2.snap, "its panel builds and its undo snapshot can be taken" + (P2.threw || P2.snap ? " — threw " + (P2.threw || P2.snap) : ""));

console.log("\n=== M. the weapon merge ===");
R.is(!r.M.threw && J(r.M.got) === J([true, true, true, true]), `all four layers merge` + (r.M.threw ? " — threw " + r.M.threw : ` (${J(r.M.got)})`));
R.is(r.M.blend === "normal" && r.M.color === "#808080" && J(r.M.chans2) === J(["color"]) && r.M.opacity2 === 1 && r.M.hue3 === 0 && r.M.scale4 === 2,
  `the merge holds what it copies to the same shapes as the project reader: ${J({ blend: r.M.blend, color: r.M.color, chans: r.M.chans2, opacity: r.M.opacity2, hue: r.M.hue3, scale: r.M.scale4 })}`);
const mMarked = r.M.panels.flatMap(p => p.marked), mThrew = r.M.panels.map(p => p.threw).filter(Boolean);
R.is(!mThrew.length && !mMarked.length, none(mMarked, "and none of them puts markup into the panel") + (mThrew.length ? " · threw " + J(mThrew) : ""));

console.log("\n=== Z. what the review of 2026-10-10 forced ===");
const zMarked = r.Z.marked.concat(r.Z.marked2), zThrew = [r.Z.threw, r.Z.threw2].filter(Boolean);
R.is(r.Z.blend === "normal" && r.Z.color === "#808080" && r.Z.hue === 0 && r.Z.sat === 100,
  `a blend, a fill's colour and an effect's numbers read straight through ProjNode keep their shapes: ${J({ blend: r.Z.blend, color: r.Z.color, hue: r.Z.hue, sat: r.Z.sat })}`);
R.is(!zThrew.length && !zMarked.length, none(zMarked, "…and put no markup into the panel") + (zThrew.length ? " · threw " + J(zThrew) : ""));

console.log("\n=== L. what this build writes ===");
R.is(r.L.same, `a group holding a styled text decal with a mirror and a band, a projection with every parameter and a Levels comes back from a save and a load exactly (${r.L.bytes} bytes)` +
  (r.L.same ? "" : "\n        first " + r.L.first + "\n        again " + r.L.again));

const errs = (r.__errs || []).filter(e => !/net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
