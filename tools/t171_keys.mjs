// Hand-made mip levels, slice (c) (ROADMAP 4.58, docs/MIP_LEVELS.md §3.2, §6.3–6.6), against the real page.
//
// WHY THIS EXISTS. A fill's colour or value and an effect's numbers may vary by mip level ("By
// distance": `keys`, one value per keyed level, interpolated between them and held past the ends),
// and four presets build the effects that ride on it out of ordinary layers. The oracle is the one the
// design names: A KEYED NUMBER AT LEVEL k IS THE KEY — the walk at level k with a keyed layer is, byte
// for byte, the walk with the same layer unkeyed and its number set to the keyed value there. Held for
// the four numbers' hue, Levels' gamma, blur's radius, noise's amount, a fill's colour on the albedo and
// its value on smoothness. Then what that has to carry through:
//   * WHERE THE CHAIN RESTARTS. A keyed value that changes between two levels is a restart, one that
//     does not is none; keys on a hidden layer or on another channel move nothing.
//   * THE EXPORT. Each level of the written file, decoded, is the keyed colour there — with the
//     Mipmaps tick off, because a texture with level content carries its chain.
//   * THE FILE. Keys are written, say version 7, and come back the same; a crafted file's keys are
//     held to known numbers, levels 0–15, at most 16, colours as #rrggbb.
//   * THE PANEL. The By distance row: one bar per level, a level's value set in one undo step, the
//     plain control of a keyed number made read-only.
//   * THE PRESETS. Holo foil, Colour flip, Distance camouflage and Metal flake build plain layers —
//     LayerNode leaves and groups the user can open — whose levels are what each promises; each is
//     one undo step.
//
// Usage: node tools/t171_keys.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }

const BODY = `async function(){
  var out = {};
  var seed = 7; var rnd = function(){ seed = (seed * 1103515245 + 12345) >>> 0; return seed >>> 8 & 255; };
  var S = 64;
  var sheet = function(n){ n = n || S; var c = mkCanvas(n, n); var g = ctx2d(c); var d = g.createImageData(n, n);
    for (var i = 0; i < n * n; i++) { d.data[i*4] = rnd(); d.data[i*4+1] = rnd(); d.data[i*4+2] = rnd(); d.data[i*4+3] = 255; }
    g.putImageData(d, 0, 0); return c; };
  var flat = function(hex, n){ var c = mkCanvas(n || S, n || S); var g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, n || S, n || S); return c; };
  var mkSlot = function(id, base){
    var s = { id: id, cStem: id, cFileName: id + ".dds", nStem: id.replace(/_c$/, "_n"), nFileName: id.replace(/_c$/, "_n") + ".dds",
      layers: [], size: S, sizeH: S, nSize: S, missing: false, cEdited: true };
    s.baseC = base || flat("#404040"); s.composite = mkCanvas(S, S); s.smooth = flat("#404040"); s.metal = flat("#000000"); s.normal = flat("#808080");
    return s;
  };
  var fill = function(hex, o){ return LayerNode.of(Object.assign({ type: "fill", name: hex, color: hex, opacity: 1, blend: "normal", visible: true }, o || {})); };
  var fx = function(o){ return LayerNode.of(Object.assign({ type: "adjust", name: "fx", visible: true, opacity: 1, blend: "normal", hue: 0, sat: 100, bright: 100, contrast: 100 }, o || {})); };
  var bytes = function(c){ return c ? ctx2d(c).getImageData(0, 0, c.width, c.height).data : null; };
  var diff = function(a, b){ if (!a || !b || a.length !== b.length) return -1; var n = 0; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
  var px = function(c, x, y){ return [].slice.call(ctx2d(c).getImageData(x || 0, y || 0, 1, 1).data).slice(0, 3); };
  var hex = function(v){ return "#" + v.map(function(x){ return (x < 16 ? "0" : "") + x.toString(16); }).join(""); };
  var keep = { slots: App.slots, active: App.activeSlot, layer: App.activeLayer, preset: $("expPreset").value,
               mips: $("optMips").checked, pad: $("optPad").checked, sel: App.selParts };
  var use = function(s){ App.slots = new Map([[s.id, s]]); App.activeSlot = s; App.activeLayer = null; App.selParts = new Set(); scheduleComposite(s); };
  // The oracle: level k of a stack holding a keyed layer, against the same stack with that layer's
  // number set by hand to what the keys give there. Both through Composite.at, so the walk is the same.
  var oracle = function(id, base, make, set, keys, ch){
    var s1 = mkSlot(id + "k_c", base), s2 = mkSlot(id + "p_c", base);
    var a = make(); a.chans[ch || "color"].keys = keys;
    s1.layers = [a];
    var res = [];
    for (var k = 0; k <= 6; k++) {
      var b = make(); set(b.chans[ch || "color"], Levels.value(keys[Object.keys(keys)[0]], k));
      s2.layers = [b];
      res.push(diff(bytes(Composite.at(s1, ch || "color", k)), bytes(Composite.at(s2, ch || "color", k))));
    }
    return res.join(",");
  };
  try {
    // ---- 1. the model: one value per level, interpolated, held past the ends ----
    var K = [[1, 10], [5, 50]];
    out.value = [0, 1, 3, 5, 7].map(function(k){ return Levels.value(K, k); }).join(",");
    out.colour = Levels.value([[0, "#000000"], [2, "#ff8040"]], 1);
    var c0 = { kind: "fill", color: "#112233" };
    out.plainSame = Levels.content(c0, 3) === c0;
    var c1 = { kind: "fill", color: "#112233", keys: { color: [[0, "#000000"], [4, "#ffffff"]] } };
    var e1 = Levels.content(c1, 2);
    out.eval = { color: e1.color, orig: c1.color, noKeys: !e1.keys, keyed: Levels.keyed(c1), plainKeyed: Levels.keyed(c0) };
    out.params = {
      fill: Levels.params({ kind: "fill", color: "#000000" }).map(function(p){ return p.id; }).join(","),
      grad: Levels.params({ kind: "fill", color: "#000000", grad: Gradient.make ? {} : {} }).length,
      hsbc: Levels.params({ kind: "effect", hue: 0, sat: 100, bright: 100, contrast: 100 }).map(function(p){ return p.id; }).join(","),
      levels: Levels.params({ kind: "effect", fx: Effect.make("levels") }).map(function(p){ return p.id; }).join(","),
      blur: Levels.params({ kind: "effect", fx: Effect.make("blur") }).map(function(p){ return p.id; }).join(","),
      sharpen: Levels.params({ kind: "effect", fx: Effect.make("sharpen") }).map(function(p){ return p.id; }).join(","),
      noise: Levels.params({ kind: "effect", fx: Effect.make("noise") }).map(function(p){ return p.id; }).join(","),
      curves: Levels.params({ kind: "effect", fx: Effect.make("curves") }).length };

    // ---- 2. the oracle: a keyed number at level k is the key ----
    var base = sheet();
    out.hue = oracle("hue", base, function(){ return fx(); }, function(c, v){ c.hue = v; }, { hue: [[0, 0], [4, 160]] });
    out.gamma = oracle("gam", base, function(){ return fx({ fx: Effect.make("levels") }); },
      function(c, v){ c.fx = Effect.clone(c.fx); c.fx.rgb.gamma = v; }, { gamma: [[1, 0.5], [5, 2.5]] });
    out.blur = oracle("blr", base, function(){ return fx({ fx: Effect.make("blur") }); },
      function(c, v){ c.fx = Effect.clone(c.fx); c.fx.radius = v; }, { radius: [[0, 1], [3, 7]] });
    out.noise = oracle("nse", base, function(){ return fx({ fx: Effect.make("noise") }); },
      function(c, v){ c.fx = Effect.clone(c.fx); c.fx.amount = v; }, { noiseAmount: [[0, 0], [6, 90]] });
    out.fillC = oracle("fc", base, function(){ return fill("#808080"); }, function(c, v){ c.color = v; }, { color: [[0, "#ff0000"], [2, "#00ff00"], [5, "#0000ff"]] });
    out.fillS = oracle("fs", base, function(){ return fill("#808080", { chan: "smooth" }); }, function(c, v){ c.color = v; }, { color: [[1, "#202020"], [4, "#f0f0f0"]] }, "smooth");
    // ...and the level itself, read off the sheet: a keyed fill at level k is that level's colour.
    var sf = mkSlot("fk_c", base);
    sf.layers = [fill("#808080", { keys: { color: [[0, "#ff0000"], [2, "#00ff00"], [4, "#0000ff"]] } })];
    out.fillAt = [0, 1, 2, 3, 4, 5].map(function(k){ return hex(px(Composite.at(sf, "color", k), 9, 9)); }).join(" ");
    // The live sheet is level 0, and the plain colour a file writes beside the keys is level 0's —
    // what a build that has never heard of keys draws — even where the one in memory is not.
    use(sf); compositeSlot(sf);
    out.live = hex(px(sf.composite, 3, 3));
    out.base0 = (await ProjNode.saveContent(sf.layers[0].chans.color, { version: 5, put: async function(){ return "f"; }, heights: new Map() })).color;

    // ---- 3. where the chain restarts ----
    var sr = mkSlot("rs_c");
    var kf = fill("#808080", { keys: { color: [[2, "#ff0000"], [4, "#0000ff"]] } });
    sr.layers = [kf];
    out.restarts = { keyed: Levels.restarts(sr, ["color"], 6).join(","), other: Levels.restarts(sr, ["smooth"], 6).join(","), any: Levels.any(sr.layers) };
    kf.visible = false;
    out.restarts.hidden = Levels.restarts(sr, ["color"], 6).join(",");
    kf.visible = true;
    var flatKeys = fill("#808080", { keys: { color: [[0, "#123456"], [6, "#123456"]] } });
    sr.layers = [flatKeys];
    out.restarts.flat = Levels.restarts(sr, ["color"], 6).join(",");
    // keys running on where the layer is not drawn move nothing there (review of (c))
    sr.layers = [fill("#808080", { levels: Levels.near(3), keys: { color: [[0, "#000000"], [6, "#ffffff"]] } })];
    out.restarts.unseen = Levels.restarts(sr, ["color"], 6).join(",");
    // a sharpen's keys do not key the noise its kind became
    var kc = { kind: "effect", hue: 0, sat: 100, bright: 100, contrast: 100, fx: Effect.make("noise"), keys: { sharpenAmount: [[0, 0], [3, 400]] } };
    out.restarts.kind = Levels.keyed(kc) + "," + Levels.content(kc, 3).fx.amount;

    // ---- 4. the export: each level decoded is the keyed colour there ----
    var se = mkSlot("ex_c");
    se.layers = [fill("#808080", { keys: { color: [[0, "#ff0000"], [2, "#00ff00"], [4, "#0000ff"]] } })];
    use(se);
    $("expPreset").value = "lossless"; $("optMips").checked = false; $("optPad").checked = false;
    var items = collectExports(false).filter(function(it){ return it.kind === "c"; });
    var done = await encodeAllTextures(items);
    var f = done.files[0], d = f && DDS.parseDDS(f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength));
    out.exp = d ? { n: d.mips.length, at: d.mips.map(function(m){ return hex([m.rgba[0], m.rgba[1], m.rgba[2]]); }).join(" ") } : null;
    out.expNote = items[0] && items[0].levelNote || null;

    // ---- 5. the file ----
    var ctx = { version: 5, put: async function(){ return "f"; }, heights: new Map() };
    var cK = Object.assign({ kind: "fill", color: "#ff0000", keys: { color: [[0, "#ff0000"], [3, "#0000ff"]] } });
    var mK = await ProjNode.saveContent(cK, ctx);
    var back = await ProjNode.loadContent(JSON.parse(JSON.stringify(mK)), { img: async function(){ return null; } });
    out.file = { version: ctx.version, keys: JSON.stringify(mK.keys), back: JSON.stringify(back.keys) };
    var ctx2 = { version: 5, put: async function(){ return "f"; }, heights: new Map() };
    await ProjNode.saveContent({ kind: "fill", color: "#ff0000" }, ctx2);
    out.file.plain = ctx2.version;
    var crafted = { color: [[99, "#00ff00"], [-3, "#zzzzzz"], [2, 7], [1.6, "#0000FF"]], hue: [[1, 30]], bogus: [[1, 2]] };
    var many = []; for (var i = 0; i < 40; i++) many.push([i % 16, "#" + (i < 16 ? "0" : "") + i.toString(16) + "0000"]);
    var bk = await ProjNode.loadContent({ kind: "fill", color: "#000000", keys: crafted }, { img: async function(){ return null; } });
    var bm = await ProjNode.loadContent({ kind: "fill", color: "#000000", keys: { color: many } }, { img: async function(){ return null; } });
    var bh = await ProjNode.loadContent({ kind: "effect", hue: 0, sat: 100, bright: 100, contrast: 100, keys: { hue: [[0, -999], [2, "x"], [3, 45]], sat: "nope" } }, { img: async function(){ return null; } });
    var bn = await ProjNode.loadContent({ kind: "fill", color: "#000000", keys: { color: [[null, "#111111"], ["3", "#222222"], [true, "#333333"], [4, "#444444"]] } }, { img: async function(){ return null; } });
    out.crafted0 = JSON.stringify(bn.keys);
    var ba = await ProjNode.loadContent({ kind: "fill", color: "#000000", keys: [[1, 2]] }, { img: async function(){ return null; } });
    out.crafted = { fill: JSON.stringify(bk.keys), many: bm.keys ? bm.keys.color.length : -1, hue: JSON.stringify(bh.keys), arr: ba.keys === undefined };
    // A copy owns its keys: changing the copy's leaves the original's alone.
    var orig = fill("#808080", { keys: { color: [[0, "#000000"], [2, "#ffffff"]] } });
    var copy = LayerNode.clone(orig);
    out.cloneOwn = copy.chans.color.keys !== orig.chans.color.keys && JSON.stringify(copy.chans.color.keys) === JSON.stringify(orig.chans.color.keys);

    // ---- 6. the panel ----
    var sp = mkSlot("ui_c");
    var Lp = fill("#808080", { name: "keyed" });
    sp.layers = [Lp];
    use(sp); App.activeLayer = Lp; compositeSlot(sp);
    LayerProps.keySel = { uid: null, param: "color", level: 3 };
    refreshLayerProps();
    out.ui = { hidden: !$("layerProps").querySelector("[data-level]") };
    // the layer menu's Vary with distance… opens it
    layerMenu({ clientX: 10, clientY: 10, preventDefault: function(){} }, sp, Lp);
    var item = [].slice.call(document.querySelectorAll("body > div > div")).find(function(d){ return /^Vary with distance/.test(d.textContent); });
    out.ui.menu = !!item;
    if (item) item.click();
    out.ui.opened = !!$("layerProps").querySelector("[data-level]");
    LayerProps.keySel.param = "color"; LayerProps.keySel.level = 3;
    refreshLayerProps();
    refreshLayerProps();
    var host = $("layerProps");
    var bars = host.querySelectorAll("[data-level]");
    out.ui = { hidden: out.ui.hidden, menu: out.ui.menu, opened: out.ui.opened, bars: bars.length, sel: host.querySelector("[data-level='3']") ? host.querySelector("[data-level='3']").className : "" };
    var inp = host.querySelector("input[data-key]");
    out.ui.input = inp ? inp.type : null;
    if (inp) { inp.value = "#00ff00"; inp.dispatchEvent(new Event("input")); out.ui.live = inp.isConnected; inp.dispatchEvent(new Event("change")); }
    out.ui.keys = JSON.stringify(Lp.chans.color.keys);
    out.ui.level3 = hex(px(Composite.at(sp, "color", 3), 1, 1));
    out.ui.level0 = hex(px(Composite.at(sp, "color", 0), 1, 1));
    doUndo(true);
    out.ui.undone = Lp.chans.color.keys === undefined || Lp.chans.color.keys === null;
    doRedo(true);
    out.ui.redone = JSON.stringify(Lp.chans.color.keys);
    refreshLayerProps();
    var plainCol = [].slice.call(host.querySelectorAll("input[type=color]")).filter(function(x){ return !x.hasAttribute("data-key"); });
    out.ui.plainLocked = plainCol.length ? plainCol.every(function(x){ return x.disabled; }) : "none";
    // a number: the four numbers' hue, and its plain slider read-only while keyed
    var Lh = fx({ name: "hue" }); Lh.chans.color.keys = { hue: [[0, 0], [4, 90]] };
    sp.layers = [Lp, Lh]; App.activeLayer = Lh;
    LayerProps.keySel = { uid: Lh.uid, param: "hue", level: 2 };
    refreshLayerProps();
    var rng = host.querySelector("input[data-key]");
    out.ui.num = rng ? { type: rng.type, value: +rng.value } : null;
    var hueRow = [].slice.call(host.querySelectorAll(".row")).find(function(r){ var l = r.querySelector("label"); return l && l.textContent === "hue"; });
    out.ui.hueLocked = hueRow ? hueRow.querySelector("input[type=range]").disabled : "none";
    // the panel's choice belongs to the layer it was made on: another keyed layer opens on its own keys
    var Ls = fx({ name: "sat" }); Ls.chans.color.keys = { sat: [[0, 100], [4, 200]] };
    sp.layers = [Lp, Lh, Ls]; App.activeLayer = Ls;
    refreshLayerProps();
    var ssel = host.querySelector("[data-level]") && host.querySelector("[data-level]").closest(".row").previousElementSibling.querySelector("select");
    out.ui.other = ssel ? ssel.value + "@" + (host.querySelector("input[data-key]") ? host.querySelector("input[data-key]").value : "") : null;

    // ---- 7. the presets: plain layers, one undo step each ----
    var plain = function(n){ return isGroup(n) ? n.children.every(plain) : Object.getPrototypeOf(n) === LayerNode.proto; };
    var meanAt = function(s, ch, k){ var c = Composite.at(s, ch, k); return c ? px(c, 5, 5) : null; };
    var s7 = mkSlot("pr_c", flat("#404040")); use(s7); compositeSlot(s7);
    out.presets = { ids: Levels.PRESETS.map(function(p){ return p.id; }).join(",") };
    var H = Levels.preset(s7, "holo", { palette: "rainbow", first: 2, cycle: 4, strength: 100 });
    var holoLeaves = H ? layerLeaves([H]) : [];
    var hc = holoLeaves.find(function(x){ return LayerNode.contentOn(x, "color"); });
    out.presets.holo = { plain: !!H && plain(H), n: holoLeaves.length, chans: holoLeaves.map(function(x){ return LayerNode.channelsOf(x).join("+"); }).join(" "),
      at2: hc ? Levels.content(hc.chans.color, 2).color : null, at4: hc ? Levels.content(hc.chans.color, 4).color : null,
      levels: H && H.levels ? JSON.stringify(H.levels) : JSON.stringify(holoLeaves.map(function(x){ return x.levels; })),
      smooth: meanAt(s7, "smooth", 3) ? meanAt(s7, "smooth", 3)[0] : null, smooth0: s7.layers.length };
    var u0 = s7.layers.length; doUndo(true); out.presets.holoUndo = s7.layers.length === u0 - 1; doRedo(true);
    s7.layers = [];
    var F = Levels.preset(s7, "flip", { near: "#ff0000", far: "#0000ff", cross: 3, soft: 0, blend: "normal" });
    out.presets.flip = { plain: !!F && plain(F), l2: hex(meanAt(s7, "color", 2)), l3: hex(meanAt(s7, "color", 3)), l0: hex(meanAt(s7, "color", 0)) };
    s7.layers = [];
    var gN = newGroupNode("Near look"); gN.children = [fill("#ff0000")];
    var gF = newGroupNode("Far look"); gF.children = [fill("#0000ff")];
    s7.layers = [gN, gF];
    Levels.preset(s7, "camo", { near: gN.uid, far: gF.uid, cross: 3, soft: 1 });
    out.presets.camo = { near: JSON.stringify(gN.levels), far: JSON.stringify(gF.levels), l0: hex(meanAt(s7, "color", 0)), l5: hex(meanAt(s7, "color", 5)) };
    doUndo(true); out.presets.camoUndo = !gN.levels && !gF.levels;
    // two groups one inside the other weigh 0 together at every level: refused
    var gIn = newGroupNode("Inner"); gIn.children = [fill("#00ff00")]; gN.children.push(gIn);
    out.presets.nested = Levels.preset(s7, "camo", { near: gN.uid, far: gIn.uid, cross: 3, soft: 0 }) === null && !gN.levels && !gIn.levels;
    // the flake is gloss and metalness: no _n, no flake; the holo is colour alone there
    var sNo = mkSlot("pn_c"); sNo.smooth = sNo.metal = sNo.normal = null; App.slots.set(sNo.id, sNo);
    out.presets.noN = Levels.preset(sNo, "flake", { amount: 60, gloss: 200, metal: 230, cross: 2 }) === null;
    var Hn = Levels.preset(sNo, "holo", { palette: "foil", first: 1, cycle: 3, strength: 60 });
    out.presets.noNholo = Hn ? layerLeaves([Hn]).length : -1;
    s7.layers = [];
    var M = Levels.preset(s7, "flake", { amount: 60, gloss: 200, metal: 230, cross: 2 });
    var ml = M ? layerLeaves([M]) : [];
    out.presets.flake = { plain: !!M && plain(M), kinds: ml.map(function(x){ var ch = LayerNode.channelsOf(x)[0]; var c = x.chans[ch]; return ch + ":" + (c.fx ? c.fx.type : c.kind) + ":" + (x.levels ? Levels.short(x.levels) : "all"); }).join(" "),
      s3: meanAt(s7, "smooth", 3) ? meanAt(s7, "smooth", 3)[0] : null, m3: meanAt(s7, "metal", 3) ? meanAt(s7, "metal", 3)[0] : null };
    // the dialog opens, with every preset, and its caveat line
    LayerProps.presetDialog(s7);
    var dlg = $("modalHost").querySelector(".modal:last-child");
    out.dialog = dlg ? { opts: dlg.querySelectorAll("select[data-preset] option").length, text: dlg.textContent.indexOf("UserSkin") >= 0 } : null;
    if (dlg) dlg.remove();
  } catch (e) { out.__threw = String(e && e.stack || e); }
  finally {
    App.slots = keep.slots; App.activeSlot = keep.active; App.activeLayer = keep.layer; App.selParts = keep.sel;
    $("expPreset").value = keep.preset; $("optMips").checked = keep.mips; $("optPad").checked = keep.pad;
  }
  return out;
}`;

const r0 = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!r0.ok) { console.log("FAIL: " + r0.reason); process.exit(1); }
const r = r0.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log("\n=== the model ===");
R.is(r.value === "10,10,30,50,50", `keys [[1,10],[5,50]] read 10,10,30,50,50 at levels 0,1,3,5,7 — held past the ends, linear between (${r.value})`);
R.is(r.colour === "#804020", `a colour runs byte by byte: halfway from black to #ff8040 is #804020 (${r.colour})`);
R.is(r.plainSame, "a content with no keys is handed back as it is — the walk costs nothing more");
R.is(r.eval.color === "#808080" && r.eval.orig === "#112233" && r.eval.noKeys && r.eval.keyed && !r.eval.plainKeyed,
  `a keyed content at level 2 is a copy with the value there, the record untouched (${JSON.stringify(r.eval)})`);
R.is(r.params.fill === "color" && r.params.grad === 0 && r.params.hsbc === "hue,sat,bright,contrast" && r.params.levels === "inLo,inHi,gamma" &&
  r.params.blur === "radius" && r.params.sharpen === "sharpenAmount" && r.params.noise === "noiseAmount" && r.params.curves === 0,
  `what can vary: a flat fill's colour, the four numbers, Levels' black, white and gamma, blur's radius, sharpen's and noise's amount — not a gradient or Curves (${JSON.stringify(r.params)})`);

console.log("\n=== the oracle: a keyed number at level k is the key ===");
const zeros = "0,0,0,0,0,0,0";
for (const [k, w] of [["hue", "the four numbers' hue"], ["gamma", "Levels' gamma"], ["blur", "blur's radius"], ["noise", "noise's amount"],
                      ["fillC", "a fill's colour"], ["fillS", "a fill's value on smoothness"]])
  R.is(r[k] === zeros, `${w}: levels 0–6 with keys equal the unkeyed layer set to the keyed value there, byte for byte (differing bytes ${r[k]})`);
R.is(r.fillAt === "#ff0000 #808000 #00ff00 #008080 #0000ff #0000ff", `a keyed fill reads its keys level by level (${r.fillAt})`);
R.is(r.live === "#ff0000" && r.base0 === "#ff0000", `the live sheet is level 0, and the colour beside the keys is level 0's (${r.live}, ${r.base0})`);

console.log("\n=== where the chain restarts ===");
R.is(r.restarts.keyed === "0,3,4" && r.restarts.any, `a fill keyed red at 2 and blue at 4 restarts at 3 and 4, where its colour changes (${r.restarts.keyed})`);
R.is(r.restarts.unseen === "0,1,2,3", `a near-only layer's keys running on past it restart only where it is drawn, and where it goes (${r.restarts.unseen})`);
R.is(r.restarts.kind === "false,24", `keys made for a sharpen's amount do not key the noise its kind became (${r.restarts.kind})`);
R.is(r.restarts.other === "0" && r.restarts.hidden === "0" && r.restarts.flat === "0",
  `keys on another channel, on a hidden layer, or keys that never change move nothing (${r.restarts.other} ${r.restarts.hidden} ${r.restarts.flat})`);

console.log("\n=== the export ===");
R.is(r.exp && r.exp.n === 7 && r.exp.at === "#ff0000 #808000 #00ff00 #008080 #0000ff #0000ff #0000ff",
  `each exported level, decoded, is the keyed colour there — with the Mipmaps tick off (${JSON.stringify(r.exp)})`);

console.log("\n=== the file ===");
R.is(r.file.version === 7 && r.file.keys === r.file.back && r.file.keys === '{"color":[[0,"#ff0000"],[3,"#0000ff"]]}' && r.file.plain === 5,
  `keys are written, the file says 7, and they read back the same; a content without keys leaves it at 5 (${JSON.stringify(r.file)})`);
R.is(r.crafted.fill === '{"color":[[2,"#0000ff"],[15,"#00ff00"]]}',
  `a crafted file's keys: levels rounded and held to 0–15, a bad colour or a number on a colour dropped, an unknown or misplaced number dropped (${r.crafted.fill})`);
R.is(r.crafted.many === 16 && r.crafted.hue === '{"hue":[[0,-180],[3,45]]}' && r.crafted.arr,
  `at most 16 keys a number, a number held to its range, a non-number dropped, keys that are not an object ignored (${r.crafted.many} ${r.crafted.hue})`);
R.is(r.crafted0 === '{"color":[[4,"#444444"]]}', `a level that is not a number — null, a string, true — is dropped, not read as 0 (${r.crafted0})`);
R.is(r.cloneOwn, "a copied layer owns its keys");

console.log("\n=== the panel ===");
R.is(r.ui.hidden && r.ui.menu && r.ui.opened, `an unkeyed fill's panel has no By distance row until the layer menu's Vary with distance… opens it — every other panel is as it was (${r.ui.hidden} ${r.ui.menu} ${r.ui.opened})`);
R.is(r.ui.bars === 7 && /\bon\b/.test(r.ui.sel) && r.ui.input === "color",
  `By distance shows one bar per level of the 64² sheet (7), the chosen one marked, and a colour input for it (${JSON.stringify(r.ui)})`);
R.is(r.ui.keys === '{"color":[[0,"#808080"],[3,"#00ff00"]]}' && r.ui.level3 === "#00ff00" && r.ui.level0 === "#808080",
  `setting level 3 keys it, anchored at level 0 on the colour it had (${r.ui.keys}, level 3 ${r.ui.level3}, level 0 ${r.ui.level0})`);
R.is(r.ui.live === true, "a value moving live leaves its control in place — the panel is not rebuilt under the pointer");
R.is(r.ui.undone && r.ui.redone === r.ui.keys, "one undo step takes the keys off, and redo puts them back");
R.is(r.ui.plainLocked === true, `the plain colour row is read-only while the colour is keyed (${r.ui.plainLocked})`);
R.is(r.ui.num && r.ui.num.type === "range" && r.ui.num.value === 45 && r.ui.hueLocked === true,
  `a keyed hue: a slider reading the interpolated 45 at level 2, the plain hue slider read-only (${JSON.stringify(r.ui.num)}, ${r.ui.hueLocked})`);

console.log("\n=== the presets ===");
R.is(r.ui.other === "sat@100", `another keyed layer opens on its own keyed number at level 0, not the choice made on the last one (${r.ui.other})`);

const P = r.presets;
R.is(P.ids === "holo,flip,camo,flake", `four presets (${P.ids})`);
R.is(P.holo.plain && P.holo.n === 3 && P.holo.chans === "color smooth metal" && P.holo.at2 === "#ff0000" && P.holo.at4 === "#00ff00",
  `Holo foil: a group of three plain layers — the colour keyed along the palette from level 2, a cycle every 4 levels, and gloss and metalness (${JSON.stringify(P.holo)})`);
R.is(P.holo.smooth >= 205 && P.holo.smooth <= 215 && P.holoUndo, `the foil's gloss is on the surface sheet at level 3, a quarter of the way from 200 to 245, and the preset is one undo step (${P.holo.smooth})`);
R.is(P.flip.plain && P.flip.l0 === "#ff0000" && P.flip.l2 === "#ff0000" && P.flip.l3 === "#0000ff",
  `Colour flip: near red to level 2, far blue from level 3 (${JSON.stringify(P.flip)})`);
R.is(P.camo.near === '{"from":0,"to":2,"soft":1}' && P.camo.far === '{"from":3,"to":15,"soft":1}' && P.camo.l0 === "#ff0000" && P.camo.l5 === "#0000ff" && P.camoUndo,
  `Distance camouflage: the two groups limited either side of level 3, soft 1, in one undo step (${JSON.stringify(P.camo)})`);
R.is(P.nested, "two groups one inside the other are refused for the distance camouflage (the far one would never show)");
R.is(P.noN && P.noNholo === 1, `on a texture with no _n the flake is refused and the holo is its colour alone (${P.noN} ${P.noNholo})`);
R.is(P.flake.plain && P.flake.kinds === "smooth:noise:mip 0–1 metal:noise:mip 0–1 smooth:fill:mip 2+ metal:fill:mip 2+" && P.flake.s3 === 200 && P.flake.m3 === 230,
  `Metal flake: noise in gloss and metalness at levels 0–1, the chosen sheen from level 2 (${JSON.stringify(P.flake)})`);
R.is(r.dialog && r.dialog.opts === 4 && r.dialog.text, `the dialog offers all four and says what a level effect is on a UserSkin (${JSON.stringify(r.dialog)})`);

const errs = (r.__errs || []).concat(r.__rejs || []);
R.is(!errs.length, "no uncaught error on the page" + (errs.length ? ": " + errs.join(" | ") : ""));
R.finish();
