// The text tool (ROADMAP 4.50 (3)): a decal whose image is drawn from a record, editable as text.
//
// WHY THIS EXISTS. The item's gate is three sentences — "a test font renders deterministically, a
// re-edit keeps the frame, and a project round trip keeps the text editable" — and each hides a way
// to be wrong that looks right:
//
//   * RENDERING. A text image that is trimmed to its ink, padded by guesswork or laid out from
//     `measureText` on both sides of the comparison proves nothing. So the test BUILDS a font
//     (`makeTestFont`, below: a real TrueType file of block glyphs whose advances are round numbers)
//     and loads it through the app's own FontFace path. Every position the layout must produce is then
//     known from the font's own numbers, not measured: at 100 px "I" advances 40 and "L" 70, the
//     ascent is 80 and the descent 20. Each render is compared BYTE FOR BYTE with a reference drawn by
//     the test at those positions — left, centred and right, several lines, tracked and not — so a
//     layout that is off by one pixel fails, and so does one that moves a baseline.
//   * THE DIALOG. The text tool is the decal editor in its text mode, so every edit goes through the
//     real Text button, the real text box and select and buttons, and the real Use.
//   * RE-EDIT. A floating text decal and a projected one both re-draw from the record in ONE undo
//     step. Centred text keeps its projector frame exactly and its letter size (the scale follows the
//     width, `ProjSource.scaleFor`); the sheet is then byte-identical to a fresh projection of the new
//     image. Left-aligned text keeps its LEFT edge — the ink the first letters made stays where it was
//     while the new ones extend it — and a new line keeps the first line where it was (`TextDecal.at`).
//   * ROUND TRIP. A `.wtproj` carries the record (floating and projected) AND the loaded font file,
//     beside a note that a font's licence travels with the project. The font is then taken out of the
//     page — the FontFace deleted, the memory and IndexedDB copies dropped — which is proved to change
//     what a re-render draws; the project is loaded, the font comes back from the zip, and the loaded
//     record re-draws exactly the image the file stored. That is what "editable" means.
//   * and the library and a `.wtstack` keep text as text; a font file that is not a font is refused
//     with a sentence and registers nothing.
//
// Added by the review (2026-09-26), each proved to fail with its fix taken out of the built page:
// right-to-left lettering in the order it is READ, tracked or not (it was drawn in typed order once
// tracked); floating re-edits turned, flipped and mirrored, on the sheet (a shift ignoring all three
// passed everything above); the 3-D ring's key after a centred re-edit; a depth image moved with the
// lettering rather than stretched; Use refused on a text deleted or changed under its dialog; and,
// with REAL key events, T typing no "t" and a dialog owning the keys while it is up.
//
// Usage: node tools/t113_text.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

// A TrueType font built from nothing: 1000 units to the em, ascender 800, descender −200, and five
// glyphs — space (advance 400), "-" (500), "F" (a Γ, 700), "I" (a bar, 400), "L" (700). Every outline
// sits on multiples of 100 units, so at 100 px every edge lands on a whole pixel. The asymmetric F and
// L are what would show a mirrored or flipped image. Four right-to-left letters are drawn with the
// same outlines — Hebrew alef as F and bet as I, Arabic alef as I and beh as L — so a line of them has
// a known order ON THE PAGE, the order it is read in, to be held against: tracked lines used to be
// drawn in the order they were typed, which is backwards for these (4.50 (3)'s review). Runs in the
// page (via toString), so ES5-ish.
function makeTestFont(){
  var U = 1000;
  var glyphs = [
    { adv: 500, c: [] },
    { ch: 0x20, adv: 400, c: [] },
    { ch: 0x2D, adv: 500, c: [[[100,300],[100,400],[400,400],[400,300]]] },
    { ch: 0x46, adv: 700, c: [[[100,0],[100,700],[600,700],[600,500],[300,500],[300,0]]] },
    { ch: 0x49, adv: 400, c: [[[100,0],[100,700],[300,700],[300,0]]] },
    { ch: 0x4C, adv: 700, c: [[[100,0],[100,700],[300,700],[300,200],[600,200],[600,0]]] },
  ];
  glyphs.push({ ch: 0x5D0, adv: 700, c: glyphs[3].c }, { ch: 0x5D1, adv: 400, c: glyphs[4].c },
              { ch: 0x627, adv: 400, c: glyphs[4].c }, { ch: 0x628, adv: 700, c: glyphs[5].c });
  var lastCh = Math.max.apply(null, glyphs.map(function(g){ return g.ch || 0; }));
  var W = function(){ var a = []; return {
    u8: function(v){ a.push(v & 255); }, u16: function(v){ a.push((v >> 8) & 255, v & 255); },
    i16: function(v){ v = v < 0 ? v + 65536 : v; a.push((v >> 8) & 255, v & 255); },
    u32: function(v){ a.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); },
    bytes: function(b){ for (var i = 0; i < b.length; i++) a.push(b[i]); },
    pad: function(n){ while (a.length % n) a.push(0); }, len: function(){ return a.length; }, out: function(){ return a; } }; };
  var bbox = function(g){ var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    g.c.forEach(function(ct){ ct.forEach(function(p){ x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }); });
    return g.c.length ? [x0, y0, x1, y1] : [0, 0, 0, 0]; };
  var glyf = W(), loca = [];
  glyphs.forEach(function(g){
    loca.push(glyf.len());
    if (!g.c.length) return;
    var b = bbox(g), n = 0;
    glyf.i16(g.c.length); glyf.i16(b[0]); glyf.i16(b[1]); glyf.i16(b[2]); glyf.i16(b[3]);
    g.c.forEach(function(ct){ n += ct.length; glyf.u16(n - 1); });
    glyf.u16(0);
    for (var i = 0; i < n; i++) glyf.u8(1);
    var px = 0, py = 0;
    g.c.forEach(function(ct){ ct.forEach(function(p){ glyf.i16(p[0] - px); px = p[0]; }); });
    g.c.forEach(function(ct){ ct.forEach(function(p){ glyf.i16(p[1] - py); py = p[1]; }); });
    glyf.pad(2);
  });
  loca.push(glyf.len());
  var locaT = W(); loca.forEach(function(o){ locaT.u16(o / 2); });
  var inked = glyphs.filter(function(g){ return g.c.length; }).map(bbox);
  var ext = function(i, f){ return f.apply(null, inked.map(function(b){ return b[i]; })); };
  var maxPts = Math.max.apply(null, glyphs.map(function(g){ return g.c.reduce(function(s, ct){ return s + ct.length; }, 0); }));
  var head = W(); head.u16(1); head.u16(0); head.u32(0x10000); head.u32(0); head.u32(0x5F0F3CF5); head.u16(3); head.u16(U);
  head.u32(0); head.u32(0); head.u32(0); head.u32(0);
  head.i16(ext(0, Math.min)); head.i16(ext(1, Math.min)); head.i16(ext(2, Math.max)); head.i16(ext(3, Math.max));
  head.u16(0); head.u16(8); head.i16(2); head.i16(0); head.i16(0);
  var hhea = W(); hhea.u32(0x10000); hhea.i16(800); hhea.i16(-200); hhea.i16(0); hhea.u16(700);
  hhea.i16(100); hhea.i16(100); hhea.i16(600); hhea.i16(1); hhea.i16(0); hhea.i16(0);
  for (var k = 0; k < 5; k++) hhea.i16(0); hhea.u16(glyphs.length);
  var maxp = W(); maxp.u32(0x10000); maxp.u16(glyphs.length); maxp.u16(maxPts); maxp.u16(1);
  maxp.u16(0); maxp.u16(0); maxp.u16(2); for (k = 0; k < 8; k++) maxp.u16(0);
  var hmtx = W(); glyphs.forEach(function(g){ hmtx.u16(g.adv); hmtx.i16(bbox(g)[0]); });
  var os2 = W(); os2.u16(4); os2.i16(500); os2.u16(400); os2.u16(5); os2.u16(0);
  [650, 600, 0, 75, 650, 600, 0, 350, 50, 300].forEach(function(v){ os2.i16(v); });
  os2.i16(0); for (k = 0; k < 10; k++) os2.u8(0);
  os2.u32(1); os2.u32(0); os2.u32(0); os2.u32(0); os2.bytes([87, 84, 83, 83]);
  os2.u16(0xC0); os2.u16(0x20); os2.u16(lastCh); os2.i16(800); os2.i16(-200); os2.i16(0); os2.u16(800); os2.u16(200);
  os2.u32(1); os2.u32(0); os2.i16(500); os2.i16(700); os2.u16(0); os2.u16(0x20); os2.u16(1);
  var mapped = glyphs.map(function(g, i){ return { ch: g.ch, id: i }; }).filter(function(m){ return m.ch != null; });
  var seg = mapped.length + 1, sr = 2 * Math.pow(2, Math.floor(Math.log2(seg)));
  var cmap = W(); cmap.u16(0); cmap.u16(1); cmap.u16(3); cmap.u16(1); cmap.u32(12);
  cmap.u16(4); cmap.u16(16 + seg * 8); cmap.u16(0); cmap.u16(seg * 2); cmap.u16(sr); cmap.u16(Math.log2(sr / 2)); cmap.u16(seg * 2 - sr);
  mapped.forEach(function(m){ cmap.u16(m.ch); }); cmap.u16(0xFFFF); cmap.u16(0);
  mapped.forEach(function(m){ cmap.u16(m.ch); }); cmap.u16(0xFFFF);
  mapped.forEach(function(m){ cmap.u16((m.id - m.ch + 65536) % 65536); }); cmap.u16(1);
  mapped.forEach(function(){ cmap.u16(0); }); cmap.u16(0);
  var names = [[1, "WTSS Test Blocks"], [2, "Regular"], [3, "WTSS Test Blocks Regular"], [4, "WTSS Test Blocks"], [5, "Version 1.000"], [6, "WTSSTestBlocks-Regular"]];
  var name = W(), strs = W();
  name.u16(0); name.u16(names.length); name.u16(6 + 12 * names.length);
  names.forEach(function(nm){
    var off = strs.len();
    for (var i = 0; i < nm[1].length; i++) strs.u16(nm[1].charCodeAt(i));
    name.u16(3); name.u16(1); name.u16(0x409); name.u16(nm[0]); name.u16(nm[1].length * 2); name.u16(off);
  });
  name.bytes(strs.out());
  var post = W(); post.u32(0x30000); post.u32(0); post.i16(-100); post.i16(50); for (k = 0; k < 5; k++) post.u32(0);
  var tables = [["OS/2", os2], ["cmap", cmap], ["glyf", glyf], ["head", head], ["hhea", hhea], ["hmtx", hmtx],
                ["loca", locaT], ["maxp", maxp], ["name", name], ["post", post]];
  var sum = function(b){ var s = 0; for (var i = 0; i < b.length; i += 4) s = (s + ((b[i] << 24) | ((b[i+1] || 0) << 16) | ((b[i+2] || 0) << 8) | (b[i+3] || 0))) >>> 0; return s; };
  var nT = tables.length, srT = 16 * Math.pow(2, Math.floor(Math.log2(nT)));
  var out = W(); out.u32(0x10000); out.u16(nT); out.u16(srT); out.u16(Math.log2(srT / 16)); out.u16(nT * 16 - srT);
  var off = 12 + 16 * nT, body = W(), headAt = 0;
  tables.forEach(function(t){
    var b = t[1].out();
    if (t[0] === "head") headAt = off + body.len();
    out.bytes(t[0].split("").map(function(ch){ return ch.charCodeAt(0); }));
    out.u32(sum(b)); out.u32(off + body.len()); out.u32(b.length);
    body.bytes(b); body.pad(4);
  });
  out.bytes(body.out());
  var font = out.out(), adj = (0xB1B0AFBA - sum(font)) >>> 0;
  font[headAt + 8] = adj >>> 24; font[headAt + 9] = (adj >>> 16) & 255; font[headAt + 10] = (adj >>> 8) & 255; font[headAt + 11] = adj & 255;
  return new Uint8Array(font).buffer;
}

const BODY = `async function(){
  var makeTestFont = ${makeTestFont.toString()};
  var out = {}, N = 256;
  var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ r(); }); }); };
  var settle = async function(n){ for (var i = 0; i < (n || 3); i++) await frame(); };
  var flat = function(hex){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
  var bytes = function(c){ return ctx2d(c).getImageData(0, 0, c.width, c.height).data; };
  var diff = function(a, b){ if (a.length !== b.length) return { off: -1, worst: -1 }; var off = 0, worst = 0; for (var i = 0; i < a.length; i++) { var q = Math.abs(a[i] - b[i]); if (q) off++; if (q > worst) worst = q; } return { off: off, worst: worst }; };
  var status = function(){ return document.getElementById("status").textContent; };
  var dlgEl = function(){ var all = document.querySelectorAll("#modalHost .modal"); return all.length ? all[all.length - 1] : null; };
  var btnIn = function(el, re){ return [].slice.call(el.querySelectorAll("button")).filter(function(b){ return re.test(b.textContent); })[0] || null; };
  var rowOf = function(dlg, label){ return [].slice.call(dlg.querySelectorAll(".decside .row")).filter(function(r){ var l = r.querySelector("label"); return l && l.textContent === label; })[0] || null; };
  var steps = function(){ return App.undoStack.length; };
  var typeIn = function(el, v){ el.value = v; el.dispatchEvent(new Event("input")); };

  // ---- the font, through the app's own FontFace path ----
  var buf = makeTestFont();
  var F = await TextDecal.addFont(buf, "WTSS Test Blocks.ttf");
  var id = F.id, FAM = '"wtss-' + id + '"';
  out.font = { id: id, name: F.name, fmt: F.fmt, loaded: F.face.status, has: document.fonts.has(F.face), bytes: buf.byteLength };
  var nFonts = TextDecal.fonts.size, junk = null;
  try { await TextDecal.addFont(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer, "junk.ttf"); } catch (e) { junk = e.message; }
  out.junk = { said: junk, added: TextDecal.fonts.size - nFonts };
  var again = await TextDecal.addFont(buf.slice(0), "renamed.ttf");
  out.dedupe = again === F && TextDecal.fonts.size === nFonts;

  // ---- rendering: the app's image against a reference drawn at the font's own numbers ----
  // I advances 40 at 100 px, L and F 70; ascent 80, descent 20; the pad is 2 on every side.
  var rec = function(o){ return Object.assign({ string: "IL", font: "WTSS Test Blocks", fontId: id, size: 100, weight: 400, tracking: 0,
                                                leading: 120, align: "left", colour: "#ff0000" }, o || {}); };
  var ref = function(w, h, runs){
    var c = mkCanvas(w, h), g = ctx2d(c);
    g.font = "400 100px " + FAM; g.fillStyle = "#ff0000"; g.textBaseline = "alphabetic"; g.textAlign = "left";
    runs.forEach(function(r){ g.fillText(r[0], r[1], r[2]); });
    return c;
  };
  var vs = function(t, w, h, runs){
    var a = TextDecal.render(t), b = ref(w, h, runs);
    return { w: a.width, h: a.height, want: [w, h], d: diff(bytes(a), bytes(b)) };
  };
  out.r = {
    one: vs(rec(), 114, 104, [["IL", 2, 82]]),
    tracked: vs(rec({ tracking: 100 }), 124, 104, [["I", 2, 82], ["L", 52, 82]]),
    right: vs(rec({ string: "I\\nIL", leading: 150, align: "right" }), 114, 254, [["I", 72, 82], ["IL", 2, 232]]),
    centre: vs(rec({ string: "IL\\nI\\nFIL", leading: 100, align: "center" }), 184, 304, [["IL", 37, 82], ["I", 72, 182], ["FIL", 2, 282]]),
  };
  var t1 = TextDecal.render(rec()), t2 = TextDecal.render(rec());
  out.r.twice = diff(bytes(t1), bytes(t2)).off;
  // Colour: every fully covered texel is exactly the record's colour.
  (function(){ var d = bytes(t1), bad = 0, full = 0; for (var i = 0; i < d.length; i += 4) if (d[i+3] === 255) { full++; if (d[i] !== 255 || d[i+1] || d[i+2]) bad++; } out.r.colour = { full: full, bad: bad }; })();
  out.r.norm = TextDecal.norm({ size: 9999, weight: 450, align: "justify", colour: "red", tracking: "x" });
  out.r.big = TextDecal.problem(rec({ size: 512, string: "LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL" }));
  try { TextDecal.render(rec({ size: 512, string: "LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL" })); out.r.bigThrew = false; } catch (e) { out.r.bigThrew = /Too big/.test(e.message); }
  out.r.installed = [TextDecal.installed("sans-serif"), TextDecal.installed("WTSS No Such Font 7")];
  out.r.name = [TextDecal.nameOf({ string: "\\n  SGT. PEPPER \\nII" }), TextDecal.blank({ string: " \\n " })];
  // Right to left: alef is read first, so it is drawn RIGHTMOST — tracked or not, and inside a line
  // that starts in Latin. Hebrew alef is the F outline and bet the I; Arabic alef the I, beh the L.
  // Whether the browser spaces Arabic at all is its own call (Chrome does not: a joined script,
  // measured 2026-09-26), so the reference asks it rather than assuming either way.
  var arSpaced = (function(){ var g = ctx2d(mkCanvas(1, 1)); g.font = "400 100px " + FAM; if (!("letterSpacing" in g)) return null; g.letterSpacing = "10px"; return g.measureText("\\u0627\\u0628").width > 115; })();
  out.rtl = {
    heb: vs(rec({ string: "\\u05D0\\u05D1" }), 114, 104, [["I", 2, 82], ["F", 42, 82]]),
    hebTracked: vs(rec({ string: "\\u05D0\\u05D1", tracking: 100 }), 124, 104, [["I", 2, 82], ["F", 52, 82]]),
    mixed: vs(rec({ string: "IL \\u05D0\\u05D1", tracking: 100 }), 304, 104, [["I", 2, 82], ["L", 52, 82], ["I", 182, 82], ["F", 232, 82]]),
    ar: vs(rec({ string: "\\u0627\\u0628" }), 114, 104, [["L", 2, 82], ["I", 72, 82]]),
    arTracked: arSpaced ? vs(rec({ string: "\\u0627\\u0628", tracking: 100 }), 124, 104, [["L", 2, 82], ["I", 82, 82]])
                        : vs(rec({ string: "\\u0627\\u0628", tracking: 100 }), 114, 104, [["L", 2, 82], ["I", 72, 82]]),
    arSpaced: arSpaced,
  };

  // ---- the rig: a flat plate facing the projector, one sheet (t91's) ----
  var quad = function(name, mat){
    var idx = [0, 1, 2, 0, 2, 3], corners = [[-2,-2,0], [2,-2,0], [2,2,0], [-2,2,0]], uvc = [[0,0], [1,0], [1,1], [0,1]];
    var pos = new Float32Array(18), nor = new Float32Array(18), uv = new Float32Array(12);
    for (var k = 0; k < 6; k++) {
      var c = corners[idx[k]], t = uvc[idx[k]];
      pos[k*3] = c[0]; pos[k*3+1] = c[1]; pos[k*3+2] = c[2]; nor[k*3+2] = 1; uv[k*2] = t[0]; uv[k*2+1] = t[1];
    }
    return { name: name, mat: mat, position: pos, normal: nor, uv: uv };
  };
  var S = { id: "t113", size: N, nSize: N, layers: [], missing: false };
  S.baseC = flat("#404040"); S.composite = flat("#404040");
  S.smooth = flat("#505050"); S.metal = flat("#303030"); S.normal = flat("#8080ff");
  App.slots.set("t113", S); App.activeSlot = S; App.activeLayer = null;
  App.geomData = [quad("plate", "pmat")];
  App.meshes = new Map([["plate", { visible: true, userData: { mat: "pmat" }, material: null }]]);
  App.matSlot = new Map([["pmat", "t113"]]);
  App.modelSize = { x: 10, y: 10, z: 10 };
  App.selParts = new Set(); App.protectedParts = new Set();
  App._projGL = null;
  out.mode = projGL() ? "gl" : "canvas";
  refreshSlotList(); refreshLayerList();

  // ---- a new text through the real Text button and the real dialog ----
  document.getElementById("btnAddText").click(); await settle();
  var ov = dlgEl(), use = ov && btnIn(ov.querySelector(".foot"), /Use this text/);
  out.dlg = { open: !!ov, title: ov ? ov.querySelector(".head h2").textContent : "", noKey: ov ? !/Background/.test(ov.querySelector(".decside").textContent) : false,
              held: use ? use.disabled : null, focused: document.activeElement === (ov && ov.querySelector("textarea")) };
  var ta = ov.querySelector("textarea");
  typeIn(ta, "IL");
  var fsel = rowOf(ov, "Font").querySelector("select");
  var offered = function(){ return [].slice.call(fsel.options).some(function(o){ return o.value === "id:" + id; }); };
  for (var w0 = 0; w0 < 60 && !offered(); w0++) await frame();      // filled out of IndexedDB, asynchronously
  out.dlg.offered = [].slice.call(fsel.options).some(function(o){ return o.value === "id:" + id; });
  fsel.value = "id:" + id; await fsel.onchange(); await settle(1);
  out.dlg.weight = rowOf(ov, "Weight").querySelector("select").value;
  typeIn(rowOf(ov, "Size").querySelector("input[type=range]"), "100");
  rowOf(ov, "Align").querySelectorAll("button")[0].click();
  typeIn(rowOf(ov, "Colour").querySelector("input[type=color]"), "#ff0000");
  var prev = ov.querySelector(".decprev canvas");
  out.dlg.preview = { w: prev.width, h: prev.height, d: diff(bytes(prev), bytes(ref(114, 104, [["IL", 2, 82]]))) };
  out.dlg.name = ov.querySelector(".foot input[type=text]").value;
  out.dlg.usable = !use.disabled;
  use.click(); await settle();
  var L = layerLeaves(S.layers).filter(function(l){ return l.type === "decal"; })[0];
  out.placed = { got: !!L, text: L && JSON.stringify(L.text), want: JSON.stringify(TextDecal.norm(rec())), name: L && L.name,
                 img: L ? diff(bytes(toCanvas(L.bmp)), bytes(TextDecal.render(rec()))).off : -1, look: L && L.surf ? L.surf.preset : null };
  App.activeLayer = L; refreshLayerList(); await settle(1);

  // ---- a floating text decal re-edits as text, in one step, keeping its left edge ----
  var bEd = document.getElementById("btnDecalEditor");
  var pix = ["bgMode", "btnBgApply", "btnDecReset", "dB", "btnDecBake"];
  var locked = function(){ return pix.map(function(k){ return document.getElementById(k).disabled; }); };
  out.fl = { label: bEd.textContent, locked: locked() };
  // an image decal selected next gets its own button and its pixel edits back
  var IM = LayerNode.of({ type: "decal", name: "img", bmp: flat("#00ff00"), x: .5, y: .5, scale: .1, rot: 0, flip: false, visible: true, opacity: 1, blend: "normal" });
  S.layers.push(IM); App.activeLayer = IM; refreshLayerList(); await settle(1);
  out.fl.image = { label: bEd.textContent, locked: locked() };
  S.layers.splice(S.layers.indexOf(IM), 1); App.activeLayer = L; refreshLayerList(); await settle(1);
  out.fl.back = bEd.textContent;
  var x0 = L.x, y0 = L.y, k0 = L.scale, n0 = steps(), bmp0 = L.bmp;
  bEd.click(); await settle();
  ov = dlgEl();
  out.fl.opened = ov ? ov.querySelector("textarea").value : null;
  typeIn(ov.querySelector("textarea"), "ILL");
  btnIn(ov.querySelector(".foot"), /Use this text/).click(); await settle();
  out.fl.after = { s: L.text.string, w: L.bmp.width, steps: steps() - n0, desc: App.undoStack.length ? App.undoStack[App.undoStack.length - 1].desc : null,
                   dx: (L.x - x0) * N, want: 35 * k0, dy: L.y - y0, scale: L.scale === k0, name: L.name };
  doUndo(); await settle(1);
  out.fl.undo = { s: L.text.string, same: L.bmp === bmp0, x: L.x === x0 };
  doRedo(); await settle(1);
  out.fl.redo = L.text.string;

  // ---- ...however it is turned, flipped or mirrored — measured on the sheet ----
  // The ink the old letters made must still be ink after the edit, for the decal and for its mirrored
  // copy (drawn at the opposite turn and flip). Every re-edit above is at rot 0 with no flip and no
  // copy, and a shift that ignored all three passed them (4.50 (3)'s review, 2026-09-26).
  var NA = 1024, SA = { id: "t113a", size: NA, nSize: NA, layers: [], missing: false };
  SA.baseC = mkCanvas(NA, NA); SA.composite = mkCanvas(NA, NA);
  [SA.baseC, SA.composite].forEach(function(c){ var g = ctx2d(c); g.fillStyle = "#404040"; g.fillRect(0, 0, NA, NA); });
  App.slots.set("t113a", SA);
  var inkA = function(){ var d = bytes(SA.composite), m = new Uint8Array(NA * NA); for (var i = 0; i < NA * NA; i++) if (d[i*4] > 170 && d[i*4+1] < 110) m[i] = 1; return m; };
  var lostA = function(a, b, right){ var n = 0, was = 0, now = 0; for (var i = 0; i < a.length; i++) { if ((i % NA >= NA / 2) !== right) continue; if (b[i]) now++; if (a[i]) { was++; if (!b[i]) n++; } } return { lost: n, was: was, now: now }; };
  var turned = function(rot, flip, sym, align, s0, s1){
    var t0 = TextDecal.norm(rec({ string: s0, align: align })), t1 = TextDecal.norm(rec({ string: s1, align: align }));
    var D = LayerNode.of({ type: "decal", name: "t", bmp: TextDecal.render(t0), x: .75, y: .5, scale: 1, rot: rot, flip: flip,
                           visible: true, opacity: 1, blend: "normal", text: t0 });
    if (sym) D.sym = { x: .25, y: .5 };
    SA.layers = [D]; compositeSlot(SA);
    var a = inkA(), k0 = SelOverlay.decalKey(D), x0 = D.x, y0 = D.y;
    var r = TextDecal.applyFloating(SA, D, TextDecal.render(t1), { text: t1, name: "t", surf: null });
    compositeSlot(SA);
    var b = inkA();
    return { c: rot + "°" + (flip ? " flipped" : "") + (sym ? " with a copy" : "") + ", " + align + ", " + JSON.stringify(s0) + " → " + JSON.stringify(s1),
             ok: !!r && !r.gone, prim: lostA(a, b, true), copy: sym ? lostA(a, b, false) : null, key: SelOverlay.decalKey(D) !== k0, still: D.x === x0 && D.y === y0 };
  };
  out.turned = [[90, false, false, "left", "IL", "ILLL"], [-150, true, false, "left", "IL", "ILLL"], [37, false, false, "left", "IL", "ILLL"],
                [0, true, true, "left", "IL", "ILLL"], [90, false, true, "left", "IL", "ILLL"], [90, true, true, "right", "IL", "LLIL"],
                [90, false, false, "left", "IL", "IL\\nFF"], [0, false, false, "center", "IL", "ILLL"]].map(function(c){ return turned.apply(null, c); });

  // ---- a depth image stays where the old lettering was, and is never stretched over the new ----
  // Centred "IL" (114 px) → "ILLL" (254 px): the centre stays, so a map at half the image's
  // resolution (57 px) moves 35 px right inside a 127-px one, with nothing where there was nothing.
  var tm0 = TextDecal.norm(rec({ string: "IL", align: "center" })), tm1 = TextDecal.norm(rec({ string: "ILLL", align: "center" }));
  var DM = LayerNode.of({ type: "decal", name: "IL", bmp: TextDecal.render(tm0), x: .5, y: .5, scale: 1, rot: 0, flip: false, visible: true, opacity: 1, blend: "normal", text: tm0 });
  var hm = mkCanvas(57, 52); (function(){ var g = ctx2d(hm); g.fillStyle = "#ffffff"; g.fillRect(0, 0, 57, 52); })();
  DM.heightMap = hm; DM.heightName = "relief.png";
  SA.layers = [DM];
  TextDecal.applyFloating(SA, DM, TextDecal.render(tm1), { text: tm1, name: "IL", surf: null });
  var mA = function(c, x){ return ctx2d(toCanvas(c)).getImageData(x, 26, 1, 1).data[3]; };
  out.map = { size: [DM.heightMap.width, DM.heightMap.height], bmp: [DM.bmp.width, DM.bmp.height], name: DM.heightName,
              edge: [mA(DM.heightMap, 34), mA(DM.heightMap, 35), mA(DM.heightMap, 91), mA(DM.heightMap, 92)],
              note: [TextDecal.mapNote(hm, tm0, tm1), TextDecal.mapNote(hm, tm0, Object.assign({}, tm0, { colour: "#00ff00" })), TextDecal.mapNote(null, tm0, tm1)] };
  doUndo();
  out.map.undo = DM.heightMap === hm;
  doRedo();
  out.map.redo = DM.heightMap !== hm && DM.heightMap.width === 127;
  App.slots.delete("t113a");

  // ---- Use, when the text went away or changed while its dialog was open ----
  // Nothing under a dialog can reach it any more (the keys are held; see the end of this test), but
  // Use must still not re-draw a decal that is gone — it did, and said so — nor one an undo changed.
  var textDecal = function(){ return LayerNode.of({ type: "decal", name: "IL", bmp: TextDecal.render(rec()), x: .5, y: .5, scale: .2, rot: 0, flip: false,
                                                    visible: true, opacity: 1, blend: "normal", text: TextDecal.norm(rec()) }); };
  var G = textDecal();
  S.layers.push(G); App.activeLayer = G; refreshLayerList(); await settle(1);
  bEd.click(); await settle();
  var dG = dlgEl(); typeIn(dG.querySelector("textarea"), "ILL");
  deleteLayerAt(S, G); await settle(1);
  var nG = steps();
  btnIn(dG.querySelector(".foot"), /Use this text/).click(); await settle();
  out.gone = { said: status(), steps: steps() - nG, back: !!nodeOwner(S.layers, G), text: G.text.string };
  if (nodeOwner(S.layers, G)) S.layers.splice(S.layers.indexOf(G), 1);
  // an edit applied, the dialog opened again, and an undo reaching the decal while it is open
  var G2 = textDecal();
  S.layers.push(G2); App.activeLayer = G2; refreshLayerList(); await settle(1);
  bEd.click(); await settle();
  typeIn(dlgEl().querySelector("textarea"), "ILL"); btnIn(dlgEl().querySelector(".foot"), /Use this text/).click(); await settle();
  bEd.click(); await settle();
  var dS = dlgEl(); typeIn(dS.querySelector("textarea"), "LL");
  doUndo(); await settle(1);                                   // "ILL" goes back to "IL" under the dialog
  var nS = steps();
  btnIn(dS.querySelector(".foot"), /Use this text/).click(); await settle();
  out.stale = { said: status(), steps: steps() - nS, text: G2.text.string, back: !!nodeOwner(S.layers, G2) };
  if (nodeOwner(S.layers, G2)) S.layers.splice(S.layers.indexOf(G2), 1);
  App.activeSlot = S; App.activeLayer = L; refreshLayerList(); await settle(1);

  // ---- projected: the record rides with it, and it re-edits as text ----
  camera.position.set(0, 0, 10); camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  bakeProjection(L, { point: new THREE.Vector3(0, 0, 0.05) });
  await settle();
  var PL = layerLeaves(S.layers).filter(function(l){ return !!l.proj; })[0], P = PL && PL.proj;
  out.proj = { got: !!P, text: P && P.text ? P.text.string : null, active: App.activeLayer === PL };
  var ink = function(){ var d = bytes(PL.canvas), m = new Uint8Array(N * N), n = 0; for (var i = 0; i < N * N; i++) if (d[i*4+3] > 128 && d[i*4] > 160 && d[i*4+1] < 128) { m[i] = 1; n++; } return { m: m, n: n }; };
  var kept = function(a, b){ var lost = 0; for (var i = 0; i < a.m.length; i++) if (a.m[i] && !b.m[i]) lost++; return lost; };
  var bbox = function(a){ var x0 = N, x1 = -1, y0 = N, y1 = -1; for (var i = 0; i < a.m.length; i++) if (a.m[i]) { var x = i % N, y = (i / N) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; };
  var pe = document.getElementById("btnProjEdit");
  out.proj.label = pe.textContent;
  var editProj = async function(fn){
    pe.click(); await settle();
    var d = dlgEl(); var r = fn(d);
    btnIn(d.querySelector(".foot"), /Use this text/).click(); await settle();
    return r;
  };
  // How far the texels inside the old ink's box moved, on ALPHA: an edge texel sampled a hair
  // differently from a taller or wider image is off by a few tens at most (44, measured); a line or a
  // letter that moved by even one texel is off by ~255 along every edge it has.
  var moved = function(a, s0, s1){ var bx = bbox(a), big = 0; for (var yy = bx[1]; yy <= bx[3]; yy++) for (var xx = bx[0]; xx <= bx[2]; xx++) if (Math.abs(s0[(yy*N+xx)*4+3] - s1[(yy*N+xx)*4+3]) > 64) big++; return big; };
  // left-aligned "ILL" -> "ILLL": the three letters stay, the fourth extends them — and a depth image
  // the decal carries stays under the three (TextDecal.moveMap): "ILL" is 184 px, "ILLL" 254, and
  // the left edge does not move, so the map keeps x 0–183 of the new image and has nothing past it
  var hmP = mkCanvas(P.bmp.width, P.bmp.height); (function(){ var g = ctx2d(hmP); g.fillStyle = "#ffffff"; g.fillRect(0, 0, hmP.width, hmP.height); })();
  P.heightMap = hmP; P.heightName = "relief.png";
  var a0 = ink(), s0 = P.scale, w0 = P.bmp.width, n1 = steps(), sa0 = bytes(PL.canvas);
  var opened = await editProj(function(d){ var v = d.querySelector("textarea").value; typeIn(d.querySelector("textarea"), "ILLL"); return v; });
  var a1 = ink();
  out.left = { opened: opened, s: P.text.string, steps: steps() - n1, desc: App.undoStack[App.undoStack.length - 1].desc,
               scale: P.scale, want: s0 * P.bmp.width / w0, lost: kept(a0, a1), was: a0.n, now: a1.n, box0: bbox(a0), box1: bbox(a1),
               big: moved(a0, sa0, bytes(PL.canvas)), said: status(),
               map: { was: [hmP.width, hmP.height], size: P.heightMap ? [P.heightMap.width, P.heightMap.height] : null, bmp: [P.bmp.width, P.bmp.height],
                      edge: P.heightMap ? [mA(P.heightMap, 183), mA(P.heightMap, 184)] : null, name: P.heightName } };
  P.heightMap = null; P.heightName = null;           // the rest of this test as it was
  // centred and shorter, in one edit: the frame is kept exactly, and the sheet is a fresh projection's
  var f0 = JSON.stringify(P.frame), s1 = P.scale, w1 = P.bmp.width, sheet1 = bytes(PL.canvas), P1 = { bmp: P.bmp, text: P.text };
  await editProj(function(d){ rowOf(d, "Align").querySelectorAll("button")[1].click(); typeIn(d.querySelector("textarea"), "LI"); });
  var fresh = mkCanvas(N, N);
  renderProjection(fresh, Object.assign({}, P, { id: "fresh" }), frameFromArrays(P.frame), S);
  out.centre = { s: P.text.string, align: P.text.align, frame: JSON.stringify(P.frame) === f0, scale: P.scale, want: s1 * P.bmp.width / w1,
                 fresh: diff(bytes(PL.canvas), bytes(fresh)), img: diff(bytes(P.bmp), bytes(TextDecal.render(P.text))).off };
  doUndo(); await settle(1);
  out.centre.undo = { text: P.text.string, bmp: P.bmp === P1.bmp, sheet: diff(bytes(PL.canvas), sheet1).off, frame: JSON.stringify(P.frame) === f0 };
  doRedo(); await settle(1);
  out.centre.redo = P.text.string;
  // a new line keeps the first one where it was
  var b0 = ink(), sb0 = bytes(PL.canvas);
  await editProj(function(d){ typeIn(d.querySelector("textarea"), "LI\\nI"); });
  var b1 = ink();
  out.line = { lost: kept(b0, b1), was: b0.n, now: b1.n, box0: bbox(b0), box1: bbox(b1), big: moved(b0, sb0, bytes(PL.canvas)) };
  // typed and typed back is no edit
  var n2 = steps();
  await editProj(function(d){ typeIn(d.querySelector("textarea"), "X"); typeIn(d.querySelector("textarea"), "LI\\nI"); });
  out.noop = { steps: steps() - n2, said: status() };

  // ---- a .wtproj round trip: the record and the font file both travel ----
  var FL = LayerNode.of({ type: "decal", name: "FIL", bmp: TextDecal.render(rec({ string: "FIL" })), x: .3, y: .8, scale: .5, rot: 0, flip: false,
                          visible: true, opacity: 1, blend: "normal", text: TextDecal.norm(rec({ string: "FIL" })) });
  S.layers.push(FL);
  var savedSlots = App.slots, blob = null, realCOU = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
  App.slots = new Map([["t113", S]]);
  URL.createObjectURL = function(b){ blob = b; return "blob:stub"; };
  HTMLAnchorElement.prototype.click = function(){};
  try { await saveProject(); } finally { URL.createObjectURL = realCOU; HTMLAnchorElement.prototype.click = realClick; }
  out.rt = { said: status() };
  var zip = await JSZip.loadAsync(blob), meta = JSON.parse(await zip.file("project.json").async("string"));
  var fe = (meta.fonts || [])[0], zf = fe && zip.file(fe.file);
  var fb = zf ? new Uint8Array(await zf.async("arraybuffer")) : null, ob = new Uint8Array(buf), same = !!fb && fb.length === ob.length;
  if (same) for (var i = 0; i < ob.length; i++) if (fb[i] !== ob[i]) { same = false; break; }
  var readme = zip.file("fonts/README.txt");
  // The recovery copy (4.50 (2)) is the same file's parts, kept unzipped: the font has to be among them.
  var cp = await ProjectFile.parts();
  out.rt.copy = cp.files.some(function(f){ return f[0] === "fonts/" + id + ".ttf" && f[1].size === buf.byteLength; }) && !!(cp.meta.fonts || []).length;
  var recs = meta.slots[0].layers.map(function(lm){ var c = lm.chans && lm.chans.color; return c ? (c.proj && c.proj.text ? "proj:" + c.proj.text.string : c.text ? "img:" + c.text.string : "-") : "-"; });
  out.rt.file = { fonts: (meta.fonts || []).length, id: fe && fe.id, name: fe && fe.name, path: fe && fe.file, same: same,
                  readme: readme ? /licence travels/.test(await readme.async("string")) : false, recs: recs.join(",") };
  // take the font out of the page entirely — the FontFace, this session's copy and the stored one
  var imgBefore = bytes(TextDecal.render(P.text));
  document.fonts.delete(F.face); TextDecal.fonts.delete(id);
  await idbDel("font:" + id);
  var fi = (await idbGet("fontIndex")) || []; await idbSet("fontIndex", fi.filter(function(r){ return r.id !== id; }));
  var gone = TextDecal.render(P.text), gd = diff(bytes(gone), imgBefore);
  out.rt.gone = gd.off !== 0;                            // -1 when even the size changed, which it does
  S.layers = [];
  await loadProject(blob);
  App.slots = savedSlots;
  var P2L = layerLeaves(S.layers).filter(function(l){ return !!l.proj; })[0], P2 = P2L && P2L.proj;
  var F2 = layerLeaves(S.layers).filter(function(l){ return l.type === "decal" && l.text; })[0];
  out.rt.back = { font: TextDecal.fonts.has(id), face: TextDecal.fonts.has(id) && TextDecal.fonts.get(id).face.status,
                  proj: P2 ? JSON.stringify(P2.text) === JSON.stringify(P.text) : false,
                  projImg: P2 ? diff(bytes(TextDecal.render(P2.text)), bytes(toCanvas(P2.bmp))).off : -1,
                  float: F2 ? F2.text.string : null, floatImg: F2 ? diff(bytes(TextDecal.render(F2.text)), bytes(toCanvas(F2.bmp))).off : -1,
                  stored: !!(await idbGet("font:" + id)) };
  if (P2L) {
    App.activeLayer = P2L; refreshLayerList(); await settle(1);
    document.getElementById("btnProjEdit").click(); await settle();
    var d2 = dlgEl();
    out.rt.reopen = d2 ? { text: d2.querySelector("textarea").value, font: rowOf(d2, "Font").querySelector("select").value } : null;
    if (d2) btnIn(d2.querySelector(".foot"), /Cancel/).click();
  }

  // ---- the library keeps text as text, and keeps its font ----
  var libName = "t113 lib " + Date.now().toString(36);
  TextUI.open(); await settle();
  var d3 = dlgEl();
  typeIn(d3.querySelector("textarea"), "LIFL");
  var fs3 = rowOf(d3, "Font").querySelector("select"); fs3.value = "id:" + id; await fs3.onchange(); await settle(1);
  d3.querySelector(".foot input[type=text]").value = libName;
  btnIn(d3.querySelector(".foot"), /Save to library/).click();
  for (var w = 0; w < 40 && !/Saved/.test(status()); w++) await frame();
  var row = (await DecalLib.index()).filter(function(r){ return r.name === libName; })[0];
  var lrec = row ? await DecalLib.get(row.id) : null;
  out.lib = { saved: !!lrec, text: lrec && lrec.text ? lrec.text.string : null, font: lrec && lrec.text ? lrec.text.fontId === id : false,
              stored: !!(await idbGet("font:" + id)) };
  btnIn(d3.querySelector(".foot"), /Cancel/).click();
  if (row) await DecalLib.remove(row.id);
  await idbDel("font:" + id);
  fi = (await idbGet("fontIndex")) || []; await idbSet("fontIndex", fi.filter(function(r){ return r.id !== id; }));

  // ---- a saved stack keeps a floating text decal's record and its font ----
  var st = await Stack.pack(S, F2 || FL);
  var sz = await JSZip.loadAsync(st), sm = JSON.parse(await sz.file("stack.json").async("string"));
  out.stack = { fonts: (sm.fonts || []).length, text: sm.node && sm.node.chans && sm.node.chans.color.text ? sm.node.chans.color.text.string : null };
  return out;
}`;

// ---- the keyboard, with REAL key events (CDP Input) ----
// A key dispatched from script inserts no text, so "does pressing T type a t into the box it opens"
// is a question only a real key can answer; the same goes for which element a real click leaves the
// focus on. 4.50 (3)'s review measured both: T opened the dialog with "t" already typed, and after a
// click on one of the dialog's buttons F, B, M and Delete reached the page under it — Delete taking
// the very decal being edited. Everything here runs on a slot of its own, after the body above.
const press = async (cdp, key, code, vk, text, modifiers) => {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: modifiers || 0,
                                             text: text || undefined, unmodifiedText: text || undefined });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: modifiers || 0 });
};
const clickAt = async (cdp, x, y) => {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};
const KEY_SETUP = `(function(){
  [].slice.call(document.querySelectorAll("#modalHost .modal .head .x")).forEach(function(x){ x.click(); });
  var N = 256, flat = function(){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = "#404040"; g.fillRect(0, 0, N, N); return c; };
  var SK = { id: "t113k", size: N, nSize: N, layers: [], missing: false }; SK.baseC = flat(); SK.composite = flat();
  App.slots.set("t113k", SK); App.activeSlot = SK;
  var t0 = TextDecal.norm({ string: "IL", size: 60, align: "left", colour: "#ff0000" });
  var K = LayerNode.of({ type: "decal", name: "IL", bmp: TextDecal.render(t0), x: .5, y: .5, scale: .3, rot: 0, flip: false,
                         visible: true, opacity: 1, blend: "normal", text: t0 });
  SK.layers.push(K); App.activeLayer = K;
  window.__t113k = { S: SK, L: K, saves: 0, save: saveProject };
  window.saveProject = function(){ window.__t113k.saves++; };        // Ctrl+S under a dialog: counted, not written
  refreshSlotList(); refreshLayerList(); syncDecalUI();
  return true;
})()`;
const DLG_STATE = `(function(){ var m = document.querySelectorAll("#modalHost .modal"), d = m[m.length - 1], ta = d && d.querySelector("textarea");
  return { open: m.length, title: d ? d.querySelector(".head h2").textContent : null, value: ta ? ta.value : null, focused: !!ta && document.activeElement === ta }; })()`;
const APP_STATE = `({ fly: !!cam.fly, paint3d: !!App.paint3d, marquee: !!SelectUI.on, layers: layerLeaves(__t113k.S.layers).length,
  steps: App.undoStack.length, saves: __t113k.saves, open: document.querySelectorAll("#modalHost .modal").length })`;
const CENTRE = `(function(){ var m = document.querySelectorAll("#modalHost .modal"), d = m[m.length - 1];
  var row = [].slice.call(d.querySelectorAll(".decside .row")).filter(function(x){ var l = x.querySelector("label"); return l && l.textContent === "Align"; })[0];
  var rc = row.querySelectorAll("button")[1].getBoundingClientRect(); return { x: rc.left + rc.width / 2, y: rc.top + rc.height / 2 }; })()`;
const USE = `(function(){ var m = document.querySelectorAll("#modalHost .modal"), d = m[m.length - 1];
  [].slice.call(d.querySelectorAll(".foot button")).filter(function(b){ return /Use this text/.test(b.textContent); })[0].click(); return true; })()`;
async function keysPhase(cdp, evaluate){
  const wait = ms => evaluate(`new Promise(function(r){ setTimeout(function(){ r(true); }, ${ms}); })`);
  const k = {};
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(KEY_SETUP);
  await press(cdp, "Escape", "Escape", 27); await wait(100);           // the welcome card, if it is still up
  await evaluate(`(document.activeElement && document.activeElement.blur(), true)`);
  await press(cdp, "t", "KeyT", 84, "t"); await wait(300);
  k.t = await evaluate(DLG_STATE);
  await press(cdp, "I", "KeyI", 73, "I"); await press(cdp, "L", "KeyL", 76, "L"); await wait(100);
  k.typed = await evaluate(DLG_STATE);
  await press(cdp, "Escape", "Escape", 27); await wait(100);
  k.closed = await evaluate(`document.querySelectorAll("#modalHost .modal").length`);
  await evaluate(`(document.getElementById("btnDecalEditor").click(), true)`); await wait(400);
  k.edit = await evaluate(DLG_STATE);
  const r = await evaluate(CENTRE);
  await clickAt(cdp, r.x, r.y); await wait(100);
  k.focus = await evaluate(`document.activeElement ? document.activeElement.tagName + ":" + (document.activeElement.getAttribute("aria-label") || "") : ""`);
  // One snapshot after each: Ctrl+Z straight after Delete would put back what Delete took, and hide
  // both; and with fly mode on — which F turns on when it gets through — S is a flying key.
  k.before = await evaluate(APP_STATE);
  await press(cdp, "f", "KeyF", 70, "f"); await press(cdp, "b", "KeyB", 66, "b"); await press(cdp, "m", "KeyM", 77, "m"); await wait(100);
  k.fbm = await evaluate(APP_STATE);
  await press(cdp, "Delete", "Delete", 46); await wait(100);
  k.del = await evaluate(APP_STATE);
  await press(cdp, "z", "KeyZ", 90, "", 2); await wait(100);
  k.undo = await evaluate(APP_STATE);
  await press(cdp, "s", "KeyS", 83, "", 2); await wait(100);
  k.after = await evaluate(APP_STATE);
  await evaluate(USE); await wait(300);
  k.used = await evaluate(`({ said: document.getElementById("status").textContent, kept: !!nodeOwner(__t113k.S.layers, __t113k.L),
    align: __t113k.L.text.align, desc: App.undoStack.length ? App.undoStack[App.undoStack.length - 1].desc : null })`);
  await evaluate(`(window.saveProject = __t113k.save, App.slots.delete("t113k"), true)`);
  return k;
}

const run = await evalInPage({ browser, timeoutMs: 240000, keep: argv.includes("--keep"), drive: async ({ cdp, evaluate }) => {
  const main = await evaluate(pageExpr(BODY, 400), 150000);
  if (!main || main.__threw) return main;
  main.keys = await keysPhase(cdp, evaluate);
  return main;
} });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const o = run.result;
if (o.__threw) { console.log("FAIL: the test body threw\n" + o.__threw); process.exit(1); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const vs = (r, what) => R.is(r.w === r.want[0] && r.h === r.want[1] && r.d.off === 0,
  `${what}: ${r.w}×${r.h} (want ${r.want.join("×")}), ${r.d.off} bytes off the reference drawn at the font's own numbers`);

console.log(`\n=== a font the test built, loaded the way a user's font file is — projector: ${o.mode} ===`);
R.is(o.font.loaded === "loaded" && o.font.has && o.font.fmt === "ttf" && o.font.name === "WTSS Test Blocks",
  `a ${o.font.bytes}-byte TrueType file registers through FontFace as "wtss-${o.font.id}", named "${o.font.name}" after its file`);
R.is(o.junk.said && /not a font this browser can read/.test(o.junk.said) && o.junk.added === 0,
  `a file that is not a font is refused with a sentence and registers nothing (“${o.junk.said}”)`);
R.is(o.dedupe, "the same bytes loaded again are the same font, whatever the file is called");

console.log("\n=== the image is laid out from the font's own metrics, to the pixel ===");
vs(o.r.one, "one line");
vs(o.r.tracked, "tracking 100 — a tenth of the size between letters, none after the last");
vs(o.r.right, "two lines, right-aligned, leading 150 %");
vs(o.r.centre, "three lines, centred, leading 100 %");
R.is(o.r.twice === 0, "the same record renders the same bytes twice");
R.is(o.r.colour.full > 1000 && o.r.colour.bad === 0, `every fully covered texel is exactly the record's colour (${o.r.colour.full} of them)`);
const nm = o.r.norm;
R.is(nm.size === 512 && nm.weight === 500 && nm.align === "center" && nm.colour === "#ffffff" && nm.tracking === 0,
  `a record is clamped and defaulted: size ${nm.size}, weight ${nm.weight}, align ${nm.align}, colour ${nm.colour}, tracking ${nm.tracking}`);
R.is(/Too big to draw/.test(o.r.big) && o.r.bigThrew, `an image past ${8192} px is refused in words, not attempted (“${o.r.big}”)`);
R.is(o.r.installed[0] && !o.r.installed[1], "an installed family is told from one this computer does not have");
R.is(o.r.name[0] === "SGT. PEPPER" && o.r.name[1], `a text decal is named after its first line, full stops and all ("${o.r.name[0]}")`);

console.log("\n=== right to left: the letter read first is drawn rightmost, tracked or not ===");
const RL = o.rtl;
vs(RL.heb, "Hebrew alef bet: alef, read first, is the rightmost letter");
vs(RL.hebTracked, "Hebrew alef bet at tracking 100: in that order, a tenth of the size between them and none after");
vs(RL.mixed, "\"IL \" and then Hebrew alef bet in one tracked line: the Latin left to right, then the Hebrew right to left");
vs(RL.ar, "Arabic alef beh: alef rightmost");
R.is(RL.arSpaced !== null, "this browser's canvas can space letters (letterSpacing), which tracking is drawn with");
vs(RL.arTracked, `Arabic alef beh at tracking 100: in that order, and ${RL.arSpaced ? "spaced the way the browser spaces it" : "— a joined script this browser does not space — exactly as untracked"}`);

console.log("\n=== the Text button opens the decal editor in its text mode ===");
const D = o.dlg;
R.is(D.open && /^Text/.test(D.title) && D.noKey, `it opens as "${D.title}", with no background or adjust section to lose at the next edit`);
R.is(D.held === true && D.focused, "Use is held until there is lettering, and the cursor is in the text box");
R.is(D.offered && D.weight === "400", "the loaded font is offered, and choosing it starts it at Regular — a font file is one weight");
R.is(D.preview.w === 114 && D.preview.h === 104 && D.preview.d.off === 0, `the preview is the rendered text, byte for byte (${D.preview.d.off} off)`);
R.is(D.name === "IL" && D.usable, `the name box follows the lettering ("${D.name}"), and Use is live`);
const PL = o.placed;
R.is(PL.got && PL.text === PL.want && PL.img === 0 && PL.name === "IL",
  "Use places a decal carrying the normalised record, its image the render of it, named after it");
R.is(PL.look === "painted", `and it takes a new decal's Look, as an image does ("${PL.look}")`);

console.log("\n=== a floating text decal re-edits as text ===");
const FLt = o.fl;
R.is(FLt.label === "Edit text…" && FLt.opened === "IL", `its button reads "${FLt.label}" and opens on the lettering ("${FLt.opened}")`);
R.is(FLt.locked.every(Boolean) && FLt.image.label === "Open decal editor…" && FLt.image.locked.every(x => !x) && FLt.back === "Edit text…",
  "the panel's in-place pixel edits (key, adjust, reset) are off on text — its image is drawn from the record — and back on an image decal, whose button is its own again");
R.is(FLt.after.s === "ILL" && FLt.after.w === 184 && FLt.after.steps === 1 && FLt.after.desc === "edit text" && FLt.after.scale && FLt.after.name === "ILL",
  `"ILL" is drawn again at 184 px wide, the letters the size they were, renamed with it, in one step ("${FLt.after.desc}")`);
R.is(near(FLt.after.dx, FLt.after.want, 1e-6) && FLt.after.dy === 0,
  `left-aligned, it grows to the right: its centre moves ${FLt.after.dx.toFixed(3)} texels, half the new letter (${FLt.after.want.toFixed(3)}), so the left edge stays`);
R.is(FLt.undo.s === "IL" && FLt.undo.same && FLt.undo.x && FLt.redo === "ILL", "undo puts back the text, the very image and the place; redo the edit");
for (const t of o.turned.slice(0, -1))
  R.is(t.ok && t.prim.lost === 0 && t.prim.now > t.prim.was * 1.2 && (!t.copy || (t.copy.lost === 0 && t.copy.now > t.copy.was * 1.2)),
    `${t.c}: every texel of the old ink is still ink (${t.prim.lost} of ${t.prim.was} lost${t.copy ? `, and of its mirrored copy's ${t.copy.lost} of ${t.copy.was}` : ""}), the new letters extending it to ${t.prim.now}`);
const CT = o.turned[o.turned.length - 1];
R.is(CT.ok && CT.still && CT.key, `${CT.c}: the decal keeps its place, and the 3-D ring round it is rebuilt — only its image changed`);
const M = o.map;
R.is(M.size.join() === "127,52" && M.bmp.join() === "254,104" && M.edge.join() === "0,255,255,0" && M.undo && M.redo,
  `a depth image stays where the old lettering was rather than stretching over the new: ${M.size.join("×")} at its own resolution for a ${M.bmp.join("×")} image, the old map 35 px in with nothing either side (${M.edge}); undo puts the very map back`);
R.is(/made for the old lettering/.test(M.note[0]) && M.note[1] === "" && M.note[2] === "",
  "and the status line says the depth image was made for the old lettering — not when only the colour changed, and not when there is none");
R.is(/no longer on the sheet/.test(o.gone.said) && o.gone.steps === 0 && !o.gone.back && o.gone.text === "IL",
  `Use on a text deleted while its dialog was open re-draws nothing, puts nothing back, and says so (“${o.gone.said}”)`);
R.is(/changed while the editor was open/.test(o.stale.said) && o.stale.steps === 0 && o.stale.text === "IL" && o.stale.back,
  `Use on a text an undo changed while its dialog was open is refused, and said (“${o.stale.said}”)`);

console.log("\n=== projected text re-edits as text: ProjSource.set with the record ===");
const PR = o.proj, LE = o.left, CE = o.centre;
R.is(PR.got && PR.text === "ILL" && PR.active && PR.label === "Edit text…", `projecting keeps the record ("${PR.text}"), and the panel's button reads "${PR.label}"`);
R.is(LE.opened === "ILL" && LE.s === "ILLL" && LE.steps === 1 && LE.desc === "edit projected text", `it opens on the lettering and re-projects the edit in one step ("${LE.desc}")`);
R.is(near(LE.scale, LE.want, 1e-9), `the scale follows the width, so the letters keep their size (${LE.scale.toFixed(4)})`);
R.is(LE.was > 200 && LE.big === 0 && LE.lost <= LE.was * .02 && LE.now > LE.was * 1.2,
  `left-aligned: the first three letters stay where they were (no texel of their box off by more than 64 in alpha; ${LE.lost} of ${LE.was} edge texels cross the threshold) while the fourth extends them to ${LE.now} — box ${LE.box0} → ${LE.box1}`);
R.is(/Re-projected the edited text/.test(LE.said) && /letters the size they were/.test(LE.said), `the status line says so: “${LE.said}”`);
R.is(LE.map.size && LE.map.size.join() === LE.map.bmp.join() && LE.map.edge.join() === "255,0" && /made for the old lettering/.test(LE.said),
  `its depth image stays under the letters that stayed (${LE.map.was.join("×")} → ${LE.map.size && LE.map.size.join("×")}: to x 183 and nothing from 184), and the status line says it was made for the old lettering`);
R.is(CE.s === "LI" && CE.align === "center" && CE.frame, "centred and shorter, in one edit: the projector's frame is kept exactly");
R.is(near(CE.scale, CE.want, 1e-9) && CE.img === 0, `the scale follows the width (${CE.scale.toFixed(4)}), and the image is the record's render`);
R.is(CE.fresh.off === 0, `the sheet is byte-identical to a fresh projection of the new image at that frame and scale (${CE.fresh.off} bytes off)`);
R.is(CE.undo.text === "ILLL" && CE.undo.bmp && CE.undo.sheet === 0 && CE.undo.frame && CE.redo === "LI",
  "undo puts back the text, the very image and the sheet byte for byte; redo the edit");
R.is(o.line.was > 100 && o.line.big === 0 && o.line.lost <= o.line.was * .03 && o.line.now > o.line.was * 1.1,
  `a new line keeps the first line where it was (no texel of its box off by more than 64 in alpha; ${o.line.lost} of ${o.line.was} edge texels cross the threshold) — box ${o.line.box0} → ${o.line.box1}`);
R.is(o.noop.steps === 0 && /Nothing changed/.test(o.noop.said), `typed and typed back is no edit and no step (“${o.noop.said}”)`);

console.log("\n=== a .wtproj round trip keeps the text editable, font and all ===");
const RT = o.rt;
R.is(RT.file.fonts === 1 && RT.file.id === o.font.id && RT.file.path === "fonts/" + o.font.id + ".ttf" && RT.file.same,
  `the project carries the font file, byte for byte, as ${RT.file.path}`);
R.is(RT.file.readme && /licence travels/.test(RT.said), `beside a note that a font's licence travels with the project — in the zip, and in the status line (“${RT.said}”)`);
R.is(RT.copy, "and the recovery copy carries it too — it is the same file's parts (ProjectFile.parts, 4.50 (2))");
R.is(/proj:LI\nI/.test(RT.file.recs) && /img:FIL/.test(RT.file.recs), `and the records, projected and floating (${JSON.stringify(RT.file.recs)})`);
R.is(RT.gone, "with the font taken out of the page, the record no longer draws the same image — so the next checks can fail");
R.is(RT.back.font && RT.back.face === "loaded" && !RT.back.stored,
  "loading the project registers the font again from the zip — for the session, not into this browser's storage");
R.is(RT.back.proj && RT.back.projImg === 0, "the projected text comes back as its record, which re-draws exactly the image the file stored");
R.is(RT.back.float === "FIL" && RT.back.floatImg === 0, "and so does the floating one");
R.is(RT.reopen && RT.reopen.text === "LI\nI" && RT.reopen.font === "id:" + o.font.id, "and it opens for editing as text, in its own font");

console.log("\n=== the library and a saved stack ===");
R.is(o.lib.saved && o.lib.text === "LIFL" && o.lib.font && o.lib.stored, "Save to library keeps text as text, and keeps its loaded font in this browser");
R.is(o.stack.fonts === 1 && o.stack.text === "FIL", "a .wtstack keeps a floating text decal's record and embeds its font");

console.log("\n=== the keyboard, with real key events: T, and a dialog that owns the keys while it is up ===");
const K = o.keys || {};
R.is(K.t && K.t.open === 1 && /^Text/.test(K.t.title) && K.t.value === "" && K.t.focused,
  `T opens the text dialog with the cursor in an EMPTY text box (${JSON.stringify(K.t && K.t.value)}) — the key's own letter is not typed into it`);
R.is(K.typed && K.typed.value === "IL", `and real keys typed there land there ("${K.typed && K.typed.value}")`);
R.is(K.closed === 0, "Escape still closes the dialog — its own key, not the page's");
R.is(K.edit && /^Text — IL/.test(K.edit.title) && /^BUTTON:Centre$/.test(K.focus),
  `Edit text… on a floating text decal, then a real click on Centre: the focus is on that button, outside any text box (${K.focus})`);
const B = K.before || {}, FB = K.fbm || {}, DL = K.del || {}, UZ = K.undo || {}, A = K.after || {};
R.is(FB.fly === B.fly && FB.paint3d === B.paint3d && FB.marquee === B.marquee,
  `F, B and M typed then reach nothing under the dialog: fly ${B.fly}→${FB.fly}, 3-D painting ${B.paint3d}→${FB.paint3d}, marquee ${B.marquee}→${FB.marquee}`);
R.is(DL.layers === B.layers && DL.steps === B.steps && DL.open === 1,
  `Delete does not delete the layer being edited — ${DL.layers} layer${DL.layers === 1 ? "" : "s"} (was ${B.layers}), no step, the dialog still up`);
R.is(UZ.steps === DL.steps && UZ.layers === DL.layers, `nor does Ctrl+Z undo anything under it (${DL.steps - UZ.steps} steps undone)`);
R.is(A.saves === B.saves + 1 && A.open === 1, "Ctrl+S under a dialog still saves the project, rather than handing the key to the browser's own save-this-page");
R.is(K.used && K.used.kept && K.used.align === "center" && K.used.desc === "edit text" && /Text re-drawn/.test(K.used.said),
  `and Use then re-draws the decal it was editing, centred, in one step (“${K.used && K.used.said}”)`);

if (o.__errs && o.__errs.length) R.bad("uncaught errors in the page: " + o.__errs.join(" | "));
R.finish();
