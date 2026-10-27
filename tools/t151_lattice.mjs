// A lattice is a tile for the pattern fill: a honeycomb and its kin, its cells lined up (ROADMAP 4.55).
//
// WHY THIS EXISTS. The owner's honeycomb on the Ho 229 was masked and painted cell by cell. 4.55 asks
// for a lattice whose cells line up wherever it shows, and its first step is the lattice as a FILL: a
// tile the app draws from a record (`Procedural.latticeCells`, `GradFill.latticeTile`) and hands to the
// pattern fill, which already repeats a tile on the sheet or wraps it round the model. What makes that
// right, checked in the page:
//
//   * every shape's tile meets itself: drawn with the lattice slid half a tile it is the tile rolled
//     round, so no seam shows where one repeat meets the next;
//   * its cells are cells: in one period, hexagons 2, squares 1, diamonds 2, triangles 4, scales 2,
//     each the same size;
//   * the border is as wide as it says: a share of a hexagon's or a square's side, measured as the
//     border's share of the tile against the geometry's;
//   * each element can be off: no fill leaves the cells clear, no border leaves the fill edge to edge
//     with no seam at all (every texel opaque);
//   * through the fill: a lattice on a 256² sheet at 4 repeats puts the fill at a cell's centre and the
//     border on its edge, where the geometry says;
//   * a saved and reloaded fill keeps its lattice, a duplicate gets its own, and the layer list calls it
//     a lattice;
//   * in the panel, Fill ▸ lattice makes a honeycomb, the Cells select changes it, and undo steps back.
//
// Usage: node tools/t151_lattice.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {};
  var px = function(c){ return ctx2d(c).getImageData(0, 0, c.width, c.height).data; };
  var rgb = function(h){ var v = parseInt(h.slice(1), 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; };
  var FILL = "#203040", BORDER = "#e0c080", F = rgb(FILL), B = rgb(BORDER);
  var rec = function(kind, o){ return Object.assign({ kind: kind, fill: FILL, border: BORDER, width: .08, fillOn: true, borderOn: true }, o || {}); };
  // ---- seams: the tile drawn with the lattice slid by whole texels is the tile rolled round ----
  // A tile whose cells miss a neighbour's copy is short of paint along its own edge, where a repeat
  // meets the next. Slid by half a tile, that edge runs through the middle, and the slid tile and the
  // rolled one differ there by the whole of a colour: a missing copy did, by 255 over 48 039 texels.
  // Antialiasing is not quite the same at a new place even by whole texels — 9 to 29 levels along the
  // borders, all over the tile (2026-10-23) — so a seam is a texel off by more than 64.
  out.seam = {};
  var keepMk = mkCanvas, keepCtx = ctx2d;
  var slid = function(l, ox, oy){
    var made = null;
    mkCanvas = function(w, h){ return made = keepMk(w, h); };
    ctx2d = function(c){ var g = keepCtx(c); if (c === made) { made = null; g.translate(ox, oy); } return g; };
    try { return GradFill.latticeTile(l); } finally { mkCanvas = keepMk; ctx2d = keepCtx; }
  };
  Procedural.LATTICE.forEach(function(kind){
    var l = rec(kind), t = GradFill.latticeTile(l), W = t.width, H = t.height, ox = W >> 1, oy = H >> 1;
    var a = px(t), b = px(slid(l, ox, oy)), worst = 0, n = 0;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var q = (y * W + x) * 4, r = (((y - oy + H) % H) * W + (x - ox + W) % W) * 4, d = 0;
      for (var c = 0; c < 4; c++) d = Math.max(d, Math.abs(b[q + c] - a[r + c]));
      if (d > 64) n++;
      if (d > worst) worst = d;
    }
    out.seam[kind] = { worst: worst, off: n, w: W, h: H };
  });
  // ---- cells: fill-coloured regions of one period, joined across its edges ----
  var near = function(d, i, col){ return d[i + 3] > 250 && Math.abs(d[i] - col[0]) + Math.abs(d[i + 1] - col[1]) + Math.abs(d[i + 2] - col[2]) < 24; };
  out.cells = {};
  Procedural.LATTICE.forEach(function(kind){
    var t = GradFill.latticeTile(rec(kind, { width: .12 })), W = t.width, H = t.height, d = px(t), lab = new Int32Array(W * H), sizes = [];
    for (var i0 = 0; i0 < W * H; i0++) {
      if (lab[i0] || !near(d, i0 * 4, F)) continue;
      var id = sizes.length + 1, st = [i0], n = 0;
      lab[i0] = id;
      while (st.length) {
        var i = st.pop(), x = i % W, y = (i - x) / W; n++;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function(s){
          var j = ((y + s[1] + H) % H) * W + (x + s[0] + W) % W;
          if (!lab[j] && near(d, j * 4, F)) { lab[j] = id; st.push(j); }
        });
      }
      sizes.push(n);
    }
    sizes.sort(function(a, b){ return b - a; });
    out.cells[kind] = { n: sizes.filter(function(v){ return v > 200; }).length, sizes: sizes.slice(0, 5) };
  });
  // ---- the border's width: its share of the tile against the geometry's ----
  var share = function(kind, w){
    var t = GradFill.latticeTile(rec(kind, { width: w })), d = px(t), n = 0, all = t.width * t.height;
    for (var i = 0; i < all; i++) {
      var q = i * 4, df = Math.abs(d[q] - F[0]) + Math.abs(d[q + 1] - F[1]) + Math.abs(d[q + 2] - F[2]);
      var db = Math.abs(d[q] - B[0]) + Math.abs(d[q + 1] - B[1]) + Math.abs(d[q + 2] - B[2]);
      if (db < df) n++;
    }
    return n / all;
  };
  // a hexagon of side 1 has area 3√3/2 and gives each of its six edges' bands half to itself: 3w;
  // a square of side 1, 2w less the corner the two bands share
  out.width = { hex: share("hex", .08), hexWant: 3 * .08 / (3 * Math.sqrt(3) / 2), square: share("square", .08), squareWant: 2 * .08 - .08 * .08 };
  // ---- each element off ----
  var noFill = px(GradFill.latticeTile(rec("hex", { fillOn: false }))), nfT = GradFill.latticeTile(rec("hex"));
  // the second cell's centre (√3/2, 1.5) in tile px
  var cx = Math.round(nfT.width / 2), cy = Math.round(nfT.height / 2);
  var noBorder = px(GradFill.latticeTile(rec("hex", { borderOn: false }))), minA = 255, bord = 0;
  for (var i = 0; i < noBorder.length; i += 4) { minA = Math.min(minA, noBorder[i + 3]); if (Math.abs(noBorder[i] - B[0]) < 40 && Math.abs(noBorder[i + 2] - B[2]) < 40) bord++; }
  out.off = { clear: noFill[(cy * nfT.width + cx) * 4 + 3], edge: noFill[(cy * nfT.width + Math.round(cx + nfT.width / 2)) * 4 + 3], minA: minA, bord: bord };

  // ---- through the fill: a lattice on a 256² sheet, 4 repeats ----
  var N = 256, flat = function(hex){ var c = mkCanvas(N, N), g = ctx2d(c); g.fillStyle = hex; g.fillRect(0, 0, N, N); return c; };
  var s = { id: "t151", size: N, nSize: N, layers: [], missing: false, baseC: flat("#808080"), composite: flat("#808080"), normal: null, smooth: flat("#808080"), metal: flat("#808080") };
  App.slots = new Map([["t151", s]]); App.activeSlot = s;
  var l = rec("hex"), tile = GradFill.latticeTile(l);
  var L = LayerNode.of({ type: "fill", name: "honeycomb", color: FILL, visible: true, opacity: 1, blend: "normal",
    pat: { space: "uv", repeat: 4, size: 1, angle: 0, x: 0, y: 0, sharp: 4 }, patImg: tile, patName: "lattice", lattice: l });
  s.layers = [L]; App.activeLayer = L;
  var c = LayerNode.contentOn(L, "color"), sheet = await GradFill.render(s, "color", c, L), sd = px(sheet);
  // one tile is 64 texels wide; a unit (a hexagon's side) is 64 / √3 of them. The second cell's centre
  // is (√3/2, 1.5) units in, and its right edge's midpoint √3/2 further across.
  var u = 64 / Math.sqrt(3), ky = (64 * tile.height / tile.width) / 3;
  var at = function(x, y){ var q = (Math.floor(y) * N + Math.floor(x)) * 4; return [sd[q], sd[q + 1], sd[q + 2], sd[q + 3]]; };
  out.fill = { centre: at(Math.sqrt(3) / 2 * u, 1.5 * ky), edge: at(Math.sqrt(3) * u, 1.5 * ky), next: at(Math.sqrt(3) / 2 * u + 64, 1.5 * ky) };

  // ---- saved and loaded, duplicated, named ----
  var store = {}, nput = 0;
  var ctx = { put: async function(cv){ var k = "f" + (nput++); store[k] = cv; return k; }, img: async function(k){ return store[k] || null; } };
  var saved = await ProjNode.save(L, ctx), back = await ProjNode.load(saved, ctx), dup = LayerNode.clone(L);
  var bc = LayerNode.contentOn(back, "color"), dc = LayerNode.contentOn(dup, "color");
  out.save = { lattice: JSON.stringify(bc.lattice) === JSON.stringify(Procedural.latticeClone(l)), file: !!saved.chans.color.patFile,
               dup: dc.lattice !== c.lattice && JSON.stringify(dc.lattice) === JSON.stringify(c.lattice), name: LayerNode.wordFor(c) };

  // ---- the panel: Fill ▸ lattice on the sheet, its cells made squares, and back by undo ----
  var F0 = LayerNode.of({ type: "fill", name: "flat", color: "#405060", visible: true, opacity: 1, blend: "normal" });
  s.layers = [F0]; App.activeLayer = F0; App.undoStack.length = 0; App.redoStack.length = 0;
  refreshLayerList();
  var sec = function(){ return document.getElementById("layerList").closest(".section"); };
  var selWith = function(v){ return [].slice.call(sec().querySelectorAll("select")).find(function(x){ return [].some.call(x.options, function(o){ return o.value === v; }); }); };
  var pick = function(v){ var e = selWith(v); e.value = v; e.dispatchEvent(new Event("change")); };
  var c0 = function(){ return LayerNode.contentOn(F0, "color"); };
  pick("latuv");
  var made = { kind: c0().lattice && c0().lattice.kind, w: c0().patImg && c0().patImg.width, h: c0().patImg && c0().patImg.height, space: c0().pat && c0().pat.space };
  // the sliders write without rebuilding the rows: a change of cells after them keeps what they set
  var slide = function(label, v){
    var row = [].slice.call(sec().querySelectorAll(".row")).find(function(r){ var l = r.querySelector("label"); return l && l.textContent === label; });
    var inp = row.querySelector("input[type=range]"); inp.value = v; inp.dispatchEvent(new Event("input")); inp.dispatchEvent(new Event("change"));
  };
  slide("Repeats", 20); slide("Border width", 25);
  pick("square");
  var sq = { kind: c0().lattice.kind, h: c0().patImg.height, repeat: c0().pat.repeat, width: c0().lattice.width };
  slide("Angle", 90);
  var colour = [].slice.call(sec().querySelectorAll("input[type=color]"))[1];
  colour.value = "#ff0000"; colour.dispatchEvent(new Event("change"));
  sq.angle = c0().pat.angle; sq.border = c0().lattice.border;
  doUndo(true); doUndo(true); doUndo(true); doUndo(true);
  doUndo(true); var und1 = c0().lattice && c0().lattice.kind;
  doUndo(true); var und2 = !c0().pat && !c0().lattice;
  out.panel = { made: made, sq: sq, und1: und1, und2: und2 };
  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 180000, keep: argv.includes("--keep") });
if (!r.ok) { R.bad("could not evaluate: " + JSON.stringify(r).slice(0, 600)); R.finish(); }
const o = r.result;
if (o.__threw) { R.bad("threw: " + o.__threw); R.finish(); }
console.log("  " + JSON.stringify({ seam: o.seam, cells: o.cells, width: o.width, off: o.off, fill: o.fill, save: o.save }));
R.is(!(o.__errs || []).length, "no uncaught error on the page" + ((o.__errs || []).length ? ": " + o.__errs.join(" | ") : ""));
for (const [k, x] of Object.entries(o.seam))
  R.is(x.off === 0, `${k}: the ${x.w} × ${x.h} tile, the lattice slid half a tile, is the tile rolled round — it meets itself with no seam (${x.off} texels off by more than 64; the worst ${x.worst}, the rasteriser's own antialiasing as the edges move)`);
const want = { hex: 2, square: 1, diamond: 2, triangle: 4, scale: 2 };
for (const [k, x] of Object.entries(o.cells)) {
  const big = x.sizes.slice(0, want[k]), even = big.length && big.every(v => Math.abs(v / big[0] - 1) <= .02);
  R.is(x.n === want[k] && even, `${k}: ${x.n} cells in a period (${want[k]}), each the same size (${big.join(", ")})`);
}
const Wd = o.width;
R.is(Math.abs(Wd.hex / Wd.hexWant - 1) <= .1 && Math.abs(Wd.square / Wd.squareWant - 1) <= .1,
  `a border of 8 % is that share of a cell's side: ${(Wd.hex * 100).toFixed(2)} % of a hexagon tile against ${(Wd.hexWant * 100).toFixed(2)}, ${(Wd.square * 100).toFixed(2)} % of a square tile against ${(Wd.squareWant * 100).toFixed(2)} (±10 %)`);
R.is(o.off.clear === 0 && o.off.edge === 255, `with no fill a cell is clear (${o.off.clear}) and its border drawn (${o.off.edge})`);
R.is(o.off.minA === 255 && o.off.bord === 0, `with no border the fill runs edge to edge with no seam — every texel opaque (least ${o.off.minA}), none of the border's colour (${o.off.bord})`);
const near = (p, c) => p[3] === 255 && Math.abs(p[0] - c[0]) + Math.abs(p[1] - c[1]) + Math.abs(p[2] - c[2]) < 12;
R.is(near(o.fill.centre, [0x20, 0x30, 0x40]) && near(o.fill.next, [0x20, 0x30, 0x40]) && near(o.fill.edge, [0xe0, 0xc0, 0x80]),
  `as a fill on a 256² sheet at 4 repeats: a cell's centre is the fill (${o.fill.centre}), so is the next repeat's (${o.fill.next}), and its edge is the border (${o.fill.edge})`);
R.is(o.save.lattice && o.save.file && o.save.dup && o.save.name === "a lattice",
  `saved and loaded it is a lattice again (${o.save.lattice}), its picture stored for an older build (${o.save.file}); a duplicate has its own record (${o.save.dup}); the list calls it ${JSON.stringify(o.save.name)}`);
const PN = o.panel;
R.is(PN.made.kind === "hex" && PN.made.space === "uv" && PN.made.w === 512 && PN.made.h === 887,
  `Fill ▸ lattice, on the sheet makes a honeycomb tile at once (${PN.made.kind}, ${PN.made.w} × ${PN.made.h}, ${PN.made.space})`);
R.is(PN.sq.kind === "square" && PN.sq.h === 512 && PN.und1 === "hex" && PN.und2,
  `the Cells select makes it squares (${PN.sq.kind}, ${PN.sq.h} tall), and undo takes it back to hexagons (${PN.und1}) and then to the flat fill (${PN.und2})`);
R.is(PN.sq.repeat === 20 && PN.sq.width === .25 && PN.sq.angle === 90 && PN.sq.border === "#ff0000",
  `a change of cells or colour keeps what the sliders set before it: repeats ${PN.sq.repeat} (20), border ${PN.sq.width} (0.25), angle ${PN.sq.angle} after a colour (90), the border ${PN.sq.border}`);
R.finish();
