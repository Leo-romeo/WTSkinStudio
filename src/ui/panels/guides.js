// ---------- The 2-D view's pixel grid, rulers and guides (ROADMAP 4.50 (15)) ----------
// `Guides` (editor/guides.js) is the arithmetic and the per-slot list; this is what the user sees and
// handles: two toggles over the view, the grid and the rulers drawn over the sheet, guides pulled out
// of a ruler and put back onto one, and the one call each gesture that places something makes to
// land on a guide — the marquee (ui/panels/select.js), the shape tool's nodes (ui/panels/path.js) and
// a flat decal dragged in the view (ui/view2d.js).
//
// **Guides are handled on the rulers, not on the sheet.** The sheet belongs to whichever tool is on,
// and a guide that took the drag wherever it crossed the sheet would put a dead line through the
// brush, the marquee and the shape tool alike. So: drag out of the top ruler for a horizontal guide
// and out of the left one for a vertical guide; a guide's tab on the ruler it came out of moves it;
// and dropping it back off the sheet onto a ruler removes it. On the sheet itself a guide can be
// taken only where no tool wants the drag — painting off, no Select, no shape tool, not on a decal —
// which is the gesture that would otherwise have panned.
//
// **Snapping is on while the guides are shown, and Ctrl suspends it** for the length of the drag,
// as it does in Photoshop. Nothing here is saved with a project — see ROADMAP_DONE 4.50o for that call.
const GuidesUI = {
  on: false,                   // rulers + guides, and snapping to them
  grid: false,                 // the pixel grid
  RULER: 18,                   // the rulers' thickness in CSS px — also `--ruler` on the view (sync)
  GRAB: 4,                     // how near, in CSS px, the pointer takes hold of a guide
  drag: null,                  // a guide on the move: { s, axis, i (-1 = new), t, from, px0, over, moved }
  hot: { v: null, h: null },   // the guides the live gesture is snapped to, drawn brighter
  owned: false,                // the canvas cursor is this module's, and has to be handed back
  LINE: "rgba(0,212,255,.8)", HOT: "#9ff6ff", GONE: "rgba(255,110,110,.95)",

  dpr(){ return devicePixelRatio || 1; },
  band(){ return Math.round(GuidesUI.RULER * GuidesUI.dpr()); },
  sheet(){ const s = App.activeSlot; return s && s.composite ? s : null; },
  lines(s, axis){ return s ? Guides.lines(s.guides, axis, s.composite.width, s.composite.height) : []; },
  screen(axis, t){ return t * v2.sc + (axis === "v" ? v2.ox : v2.oy); },
  // Which ruler the pointer is on, in the view's device pixels.
  zone(p){
    if (!GuidesUI.on) return null;
    const R = GuidesUI.band(), top = p.vy < R, left = p.vx < R;
    return top && left ? "corner" : top ? "top" : left ? "left" : null;
  },
  // The guide on `axis` within reach of screen position `at`, the nearest of them; -1 for none.
  near(s, axis, at){
    const reach = GuidesUI.GRAB * GuidesUI.dpr();
    let best = -1, bd = Infinity;
    GuidesUI.lines(s, axis).forEach((t, i) => {
      const d = Math.abs(GuidesUI.screen(axis, t) - at);
      if (d <= reach && d < bd) { best = i; bd = d; }
    });
    return best;
  },
  // Only where the drag would otherwise pan — see the header.
  free(){ return !App.paint3d && !SelectUI.on && !PathUI.on; },

  // ---- the gesture ----
  // Each answers "did I take this pointer event", the way SelectUI and PathUI do.
  down(e, p){
    const z = GuidesUI.zone(p);
    if (!z) return false;
    const s = GuidesUI.sheet();
    if (!s || z === "corner") return true;
    // The top ruler holds the VERTICAL guides' tabs and makes horizontal guides; the left one the
    // other way round — each guide's tab is on the ruler it runs square to.
    const own = z === "top" ? "v" : "h";
    const i = GuidesUI.near(s, own, own === "v" ? p.vx : p.vy);
    GuidesUI.begin(s, i >= 0 ? own : (own === "v" ? "h" : "v"), i, p);
    return true;
  },
  grab(e, p){
    const s = GuidesUI.on && GuidesUI.free() ? GuidesUI.sheet() : null;
    if (!s) return false;
    const iv = GuidesUI.near(s, "v", p.vx), ih = GuidesUI.near(s, "h", p.vy);
    if (iv < 0 && ih < 0) return false;
    const dv = iv < 0 ? Infinity : Math.abs(GuidesUI.screen("v", GuidesUI.lines(s, "v")[iv]) - p.vx);
    const dh = ih < 0 ? Infinity : Math.abs(GuidesUI.screen("h", GuidesUI.lines(s, "h")[ih]) - p.vy);
    if (dv <= dh) GuidesUI.begin(s, "v", iv, p); else GuidesUI.begin(s, "h", ih, p);
    return true;
  },
  begin(s, axis, i, p){
    const from = i >= 0 ? GuidesUI.lines(s, axis)[i] : GuidesUI.at(s, axis, axis === "v" ? p.x : p.y);
    // A new guide starts on its ruler, so it is not placed until it has left it.
    GuidesUI.drag = { s, axis, i, t: from, from, px0: axis === "v" ? p.x : p.y, vx: p.vx, vy: p.vy,
                      over: i < 0, moved: false };
    GuidesUI.cursor(axis === "v" ? "ew-resize" : "ns-resize");
    draw2D();
  },
  // A whole texel, kept on the sheet.
  at(s, axis, v){ return Math.max(0, Math.min(axis === "v" ? s.composite.width : s.composite.height, Math.round(v))); },
  // Off the sheet onto its ruler, or out of the view: let go there and a guide is not placed, or is
  // removed. A vertical guide leaves sideways, so its ruler is the LEFT one, whichever it came from.
  off(axis, p){
    const R = GuidesUI.band();
    return axis === "v" ? (p.vx < R || p.vx > cnv2.width) : (p.vy < R || p.vy > cnv2.height);
  },
  move(e, p){
    const d = GuidesUI.drag;
    if (d) {
      // Two screen pixels before a press on a tab is a drag, or a click on a tab would move the
      // guide to wherever the click rounded to — sixteen texels away at a quarter zoom.
      if (!d.moved && Math.max(Math.abs(p.vx - d.vx), Math.abs(p.vy - d.vy)) > 2) d.moved = true;
      const v = d.axis === "v" ? p.x : p.y;
      // A new guide follows the pointer; an old one keeps the offset it was taken at.
      d.t = GuidesUI.at(d.s, d.axis, d.i < 0 ? v : d.from + (v - d.px0));
      d.over = GuidesUI.off(d.axis, p);
      draw2D();
      return true;
    }
    // Hover says what a press would do — never over a gesture another tool has in hand.
    if (!GuidesUI.on || SelectUI.d || PathUI.drag || v2.draggingDecal || stroke) return false;
    const z = GuidesUI.zone(p), s = GuidesUI.sheet();
    if (z) {
      let c = "default";
      if (s && z === "top") c = GuidesUI.near(s, "v", p.vx) >= 0 ? "ew-resize" : "ns-resize";
      else if (s && z === "left") c = GuidesUI.near(s, "h", p.vy) >= 0 ? "ns-resize" : "ew-resize";
      GuidesUI.cursor(c);
      if (v2.cursor) { v2.cursor = null; draw2D(); }          // no brush ring under a ruler
      return true;
    }
    if (s && GuidesUI.free()) {
      const iv = GuidesUI.near(s, "v", p.vx), ih = GuidesUI.near(s, "h", p.vy);
      if (iv >= 0 || ih >= 0) { GuidesUI.cursor(iv >= 0 ? "ew-resize" : "ns-resize"); return false; }
    }
    GuidesUI.giveBack(p);
    return false;
  },
  up(){
    const d = GuidesUI.drag;
    GuidesUI.drag = null;
    if (!d) return false;
    const s = d.s, W = s.composite.width, H = s.composite.height, word = d.axis === "v" ? "x" : "y";
    const after = () => { draw2D(); GuidesUI.sync(); };
    if (d.i < 0) {
      if (!d.over) {
        Guides.edit(s, "add guide", g => { g[d.axis].push(Guides.toRef(g, d.axis, d.t, W, H)); }, after);
        setStatus("Guide at " + word + " " + d.t + " — drag its tab on the ruler to move it, or onto a ruler to remove it. Hold Ctrl to place without snapping.", "ok");
      }
    } else if (d.over && d.moved) {
      Guides.edit(s, "remove guide", g => { g[d.axis].splice(d.i, 1); }, after);
      setStatus("Guide removed — Ctrl+Z puts it back", "ok");
    } else if (d.moved && d.t !== d.from) {
      Guides.edit(s, "move guide", g => { g[d.axis][d.i] = Guides.toRef(g, d.axis, d.t, W, H); }, after);
    }
    draw2D();
    return true;
  },
  cursor(c){ cnv2.style.cursor = c; GuidesUI.owned = true; },
  giveBack(p){
    if (!GuidesUI.owned) return;
    GuidesUI.owned = false;
    cnv2.style.cursor = "";
    SelectUI.cursor(p);                                        // its own, if Select is on
  },

  // ---- snapping, for the three gestures that place something ----
  // `xs` / `ys` are the positions the gesture offers on each axis — a point's, or a box's two edges
  // and its centre. The answer is the shift to apply to all of them.
  snap(e, xs, ys){
    const s = GuidesUI.sheet();
    if (!GuidesUI.on || !s || (e && (e.ctrlKey || e.metaKey))) { GuidesUI.hot = { v: null, h: null }; return { dx: 0, dy: 0 }; }
    const tol = Guides.SNAP_PX * GuidesUI.dpr() / Math.max(1e-6, v2.sc);
    const r = Guides.snap(xs, ys, GuidesUI.lines(s, "v"), GuidesUI.lines(s, "h"), tol);
    GuidesUI.hot = { v: r.v, h: r.h };
    return r;
  },
  snapPt(e, x, y){ const r = GuidesUI.snap(e, [x], [y]); return { x: x + r.dx, y: y + r.dy }; },
  endSnap(){ if (GuidesUI.hot.v !== null || GuidesUI.hot.h !== null) { GuidesUI.hot = { v: null, h: null }; draw2D(); } },

  // ---- drawing ----
  // In device pixels with the transform reset, after everything else, so a line is one pixel at
  // every zoom and the rulers sit over the sheet the way a window's frame does.
  draw(g, s){
    GuidesUI.syncClear();
    if (!GuidesUI.grid && !GuidesUI.on) return;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.setLineDash([]);
    if (GuidesUI.grid) GuidesUI.drawGrid(g, s);
    if (GuidesUI.on) { GuidesUI.drawGuides(g, s); GuidesUI.drawRulers(g, s); }
    g.restore();
  },
  // Every texel edge in view, once a texel is GRID_PX CSS pixels across. Below that the lines would be
  // closer than the texels are legible, and at 100 % they would BE the sheet. Faded in over the next
  // doubling rather than switched on, so zooming through the threshold does not flash.
  drawGrid(g, s){
    const k = v2.sc / GuidesUI.dpr();
    if (k < Guides.GRID_PX) return;
    const W = s.composite.width, H = s.composite.height, cw = g.canvas.width, ch = g.canvas.height;
    const x0 = Math.max(0, Math.ceil(-v2.ox / v2.sc)), x1 = Math.min(W, Math.floor((cw - v2.ox) / v2.sc));
    const y0 = Math.max(0, Math.ceil(-v2.oy / v2.sc)), y1 = Math.min(H, Math.floor((ch - v2.oy) / v2.sc));
    const top = Math.max(0, v2.oy), bot = Math.min(ch, v2.oy + H * v2.sc);
    const left = Math.max(0, v2.ox), right = Math.min(cw, v2.ox + W * v2.sc);
    g.globalAlpha = Math.min(1, .35 + .65 * (k - Guides.GRID_PX) / Guides.GRID_PX);
    // Mid-grey at half strength reads on a black sheet and a white one alike.
    g.strokeStyle = "rgba(150,158,176,.5)"; g.lineWidth = 1;
    g.beginPath();
    for (let t = x0; t <= x1; t++) { const X = Math.round(t * v2.sc + v2.ox) + .5; g.moveTo(X, top); g.lineTo(X, bot); }
    for (let t = y0; t <= y1; t++) { const Y = Math.round(t * v2.sc + v2.oy) + .5; g.moveTo(left, Y); g.lineTo(right, Y); }
    g.stroke();
    g.globalAlpha = 1;
  },
  drawGuides(g, s){
    const R = GuidesUI.band(), cw = g.canvas.width, ch = g.canvas.height, d = GuidesUI.drag;
    const one = (axis, t, style) => {
      const at = Math.round(GuidesUI.screen(axis, t)) + .5;
      if (at < R || at > (axis === "v" ? cw : ch)) return;
      g.strokeStyle = style; g.lineWidth = 1;
      g.beginPath();
      if (axis === "v") { g.moveTo(at, R); g.lineTo(at, ch); } else { g.moveTo(R, at); g.lineTo(cw, at); }
      g.stroke();
    };
    for (const axis of ["v", "h"])
      GuidesUI.lines(s, axis).forEach((t, i) => {
        if (d && d.s === s && d.axis === axis && d.i === i) return;     // drawn where it is going, below
        one(axis, t, GuidesUI.hot[axis] === t ? GuidesUI.HOT : GuidesUI.LINE);
      });
    if (d && d.s === s && (d.i >= 0 || !d.over)) {
      if (d.over) g.setLineDash([4, 3]);
      one(d.axis, d.t, d.over ? GuidesUI.GONE : GuidesUI.HOT);
      g.setLineDash([]);
    }
  },
  drawRulers(g, s){
    const R = GuidesUI.band(), cw = g.canvas.width, ch = g.canvas.height, k = GuidesUI.dpr();
    const W = s.composite.width, H = s.composite.height, sc = v2.sc, ox = v2.ox, oy = v2.oy;
    g.fillStyle = "#1b1e25";
    g.fillRect(0, 0, cw, R); g.fillRect(0, 0, R, ch);
    // Where the sheet is, along each ruler — which is how you find it again after a pan.
    g.fillStyle = "#262b35";
    const sx0 = Math.max(R, ox), sx1 = Math.min(cw, ox + W * sc), sy0 = Math.max(R, oy), sy1 = Math.min(ch, oy + H * sc);
    if (sx1 > sx0) g.fillRect(sx0, 0, sx1 - sx0, R);
    if (sy1 > sy0) g.fillRect(0, sy0, R, sy1 - sy0);
    const step = Guides.step(sc, Guides.LABEL_PX * k), minor = Guides.minor(step, sc, Guides.MINOR_PX * k);
    const ta = (R - ox) / sc, tb = (cw - ox) / sc, la = (R - oy) / sc, lb = (ch - oy) / sc;
    g.strokeStyle = "#5d6473"; g.lineWidth = 1;
    g.beginPath();
    const short = R - Math.round(R * .3);
    for (const t of Guides.ticks(ta, tb, minor)) { const x = Math.round(t * sc + ox) + .5; g.moveTo(x, t % step === 0 ? 0 : short); g.lineTo(x, R); }
    for (const t of Guides.ticks(la, lb, minor)) { const y = Math.round(t * sc + oy) + .5; g.moveTo(t % step === 0 ? 0 : short, y); g.lineTo(R, y); }
    g.stroke();
    // The numbers are texels of this sheet — the unit of the marquee's X / Y / W / H.
    g.fillStyle = "#8b91a0"; g.font = Math.round(11 * k) + "px system-ui, sans-serif"; g.textBaseline = "top";
    for (const t of Guides.ticks(ta, tb, step)) g.fillText(String(t), Math.round(t * sc + ox) + 3 * k, 2 * k);
    for (const t of Guides.ticks(la, lb, step)) {
      g.save(); g.translate(R - 2 * k, Math.round(t * sc + oy) + 3 * k); g.rotate(Math.PI / 2);
      g.fillText(String(t), 0, 0); g.restore();
    }
    GuidesUI.drawTabs(g, s, R, k);
    // Where the pointer is, when the view is following it anyway (painting, or a guide on the move).
    const d = GuidesUI.drag && GuidesUI.drag.s === s ? GuidesUI.drag : null;
    const cx = d ? (d.axis === "v" ? d.t : null) : (v2.cursor ? v2.cursor.x : null);
    const cy = d ? (d.axis === "h" ? d.t : null) : (v2.cursor ? v2.cursor.y : null);
    g.strokeStyle = Marquee.ACCENT;
    g.beginPath();
    if (cx !== null) { const x = Math.round(cx * sc + ox) + .5; if (x >= R) { g.moveTo(x, 0); g.lineTo(x, R); } }
    if (cy !== null) { const y = Math.round(cy * sc + oy) + .5; if (y >= R) { g.moveTo(0, y); g.lineTo(R, y); } }
    g.stroke();
    g.strokeStyle = "#333845";
    g.beginPath(); g.moveTo(R - .5, R); g.lineTo(R - .5, ch); g.moveTo(R, R - .5); g.lineTo(cw, R - .5); g.stroke();
    g.fillStyle = "#1b1e25"; g.fillRect(0, 0, R, R);
  },
  // A tab where each guide meets the ruler it is handled from: the handle, made visible.
  drawTabs(g, s, R, k){
    const d = GuidesUI.drag, a = 4 * k, b = 6 * k;
    for (const axis of ["v", "h"])
      GuidesUI.lines(s, axis).forEach((t, i) => {
        const live = d && d.s === s && d.axis === axis && d.i === i;
        const at = Math.round(GuidesUI.screen(axis, live ? d.t : t));
        if (at < R) return;
        g.fillStyle = live ? (d.over ? GuidesUI.GONE : GuidesUI.HOT) : GuidesUI.LINE;
        g.beginPath();
        if (axis === "v") { g.moveTo(at - a, R - b); g.lineTo(at + a, R - b); g.lineTo(at, R); }
        else { g.moveTo(R - b, at - a); g.lineTo(R - b, at + a); g.lineTo(R, at); }
        g.closePath(); g.fill();
      });
  },

  // ---- the toggles ----
  sync(){
    const bg = $("btnGuides2d"), bgr = $("btnGrid2d"), wrap = $("view2dwrap");
    if (bg) bg.classList.toggle("active", GuidesUI.on);
    if (bgr) bgr.classList.toggle("active", GuidesUI.grid);
    // The view's own buttons and label move off the rulers; the thickness is written once, here.
    if (wrap) { wrap.classList.toggle("rulers", GuidesUI.on); wrap.style.setProperty("--ruler", GuidesUI.RULER + "px"); }
    GuidesUI.syncClear();
  },
  // Offered only when it would do something: guides shown, and this sheet has some.
  syncClear(){
    const b = $("btnGuidesClear"), s = GuidesUI.sheet();
    const want = GuidesUI.on && !!s && !!s.guides && s.guides.v.length + s.guides.h.length > 0;
    if (b && b.hidden === want) b.hidden = !want;
  },
  setOn(on){
    GuidesUI.on = !!on;
    if (!GuidesUI.on) { GuidesUI.drag = null; GuidesUI.hot = { v: null, h: null }; GuidesUI.giveBack(null); }
    GuidesUI.sync();
    draw2D();
    setStatus(GuidesUI.on
      ? "Guides on — drag out of a ruler to add one. The marquee, the shape tool and flat decals snap to them; hold Ctrl to place freely."
      : "Guides hidden — nothing snaps to them until they are back", "ok");
  },
  setGrid(on){
    GuidesUI.grid = !!on;
    GuidesUI.sync();
    draw2D();
    const zoom = Math.round(v2.sc / GuidesUI.dpr() * 100);
    setStatus(!GuidesUI.grid ? "Pixel grid off"
      : v2.sc / GuidesUI.dpr() >= Guides.GRID_PX ? "Pixel grid on — every texel edge, at this zoom"
      : "Pixel grid on — it shows from " + Guides.GRID_PX * 100 + " % zoom, and the view is at " + zoom + " %", "ok");
  },
  clear(){
    const s = GuidesUI.sheet();
    if (!s || !s.guides) return;
    const n = s.guides.v.length + s.guides.h.length;
    if (Guides.edit(s, "clear guides", g => { g.v = []; g.h = []; }, () => { draw2D(); GuidesUI.sync(); }))
      setStatus("Removed " + n + " guide" + (n === 1 ? "" : "s") + " from “" + s.id + "” — Ctrl+Z brings them back", "ok");
  },
};
$("btnGrid2d").onclick = () => GuidesUI.setGrid(!GuidesUI.grid);
$("btnGuides2d").onclick = () => GuidesUI.setOn(!GuidesUI.on);
$("btnGuidesClear").onclick = () => GuidesUI.clear();
GuidesUI.sync();
