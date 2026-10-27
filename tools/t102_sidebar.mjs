// The sidebar sections stay put and only the results scroll (ROADMAP 3.6).
//
// WHY THIS EXISTS. The left column scrolled as one stack of sections with the vehicle list scrolling
// inside it — measured 2026-09-26 at a 1264 x 649 window: 2 208 px of content through a 506 px view,
// two scrollbars one inside the other, and scrolling down to the skins put the search box 1 448 px
// above the top of the view. You lost the thing you were typing into while looking at what it found.
// Now a sidebar never scrolls; the search, its chips and its sort are furniture; the two result
// lists are panes that share what is left, split by a bar. Nothing but geometry can say that is
// true, so this measures it in a real window, with real mouse events on the bar:
//
//   * at 1920 x 1080 the column does not scroll at all, the two lists are the only scrollers in it
//     and neither is inside another, and the search box is where it was after both are scrolled
//     to their ends;
//   * the lists share the height 3:2, a short skins list is held at its own rows and hands the rest
//     back, and folding either section gives its height to the other list;
//   * dragging the bar moves the boundary with the cursor, a double-click puts the stylesheet's
//     split back, and the bar is only a handle while both lists are lists;
//   * at 1280 x 720 the tab's floor does not fit, the column scrolls as a last resort, and the search
//     box still does not leave the view; nothing overlaps anything;
//   * a pane's scrollbar is 6 px; the right column never scrolls, its one pane does, and View & scene
//     is docked into that pane;
//   * (2026-10-10) every vehicle name in the list is whole, with or without the column's scrollbar,
//     and the row's download icon is at least 4.5:1 at rest, hovered and selected, measured on the
//     icon's own stroke so its own opacity counts; a dialog's choice rows keep the hover-only verb
//     label the vehicle row dropped;
//   * (2026-10-10) on a page shorter than about 810 px the nation and rank chips fold behind one chip
//     on the type row — a click, Enter and Space open and close it, and a nation picked while folded
//     shows on it — so at 1366 x 768 the whole tab fits (with four vehicle rows then; five since the
//     next item), at the 1366 x 768 laptop's 640 px page "Existing skin" is in view at the top, and
//     the bar still follows the cursor in a column where both lists start from their floors;
//   * (2026-10-10, later) on such a page the vehicle list shows five whole rows, not the three and a
//     cut fourth its 210 px floor held — at 1366 x 650, 1280 x 600, 1280 x 592 and 1366 x 768 pages and
//     on the laptop's 640 — with the "Existing skin" heading still in view at the top of a column that
//     is not scrolled, the names at the tall page's type sizes; on a page too short for five rows and
//     the heading (569 px) the floor gives way first. Folding a section there leaves its heading no
//     bottom margin, and folding "Existing skin" at 1280 x 600, 592 and 1366 x 768 the tab fits. The
//     bar's 1 px follow check moved from 1366 x 768, where five rows leave the bar only 12 px to
//     share, to a 1440 x 790 page, dragged up.
//
// Synthetic data, so it needs no install.
//
// Usage: node tools/t102_sidebar.mjs [--chrome <path>]
import { findBrowser, evalInPage, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

// Page-side helpers, installed once per window. `sb.setup(n)` fills a synthetic install with 450
// vehicles and n skins and shows the search the way the end of a folder scan does.
const HELPERS = `(async function(){
  if (document.readyState !== "complete") await new Promise(function(r){ addEventListener("load", r); });
  // What the boot left running, then two frames for the layout it changes — not a fixed 400 ms,
  // which stops being long enough on a loaded machine (the 2026-10-22 scan's (20)).
  await App.bootSettled;
  await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ r(); }); }); });
  var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ r(); }); }); }); };
  var $ = function(id){ return document.getElementById(id); };
  var box = function(id){ var r = $(id).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, left: r.left, width: r.width }; };
  var scrollers = function(root){
    return [].slice.call(root.querySelectorAll("*")).filter(function(e){
      var s = getComputedStyle(e);
      return /auto|scroll/.test(s.overflowY) && e.offsetParent !== null && e.scrollHeight > e.clientHeight + 1;
    });
  };
  window.__sb = {
    frame: frame, box: box,
    boot: function(){ return { gameEmpty: $("gameListWrap").classList.contains("empty"),
      skinsShown: getComputedStyle($("userSkinWrap")).display !== "none", sep: getComputedStyle($("listSep")).cursor }; },
    setup: async function(n){
      var tags = ["usa","germany","ussr","britain","japan","china","italy","france","sweden","israel"];
      GameUnits.nations = tags.map(function(t){ return { tag: "country_" + t, name: t }; });
      GameUnits.maxRank = 8;
      // Names the review of 2026-10-10 measured cut to 4-7 characters at every window size, the
      // longest of them ("F-4E AUP Phantom II") about 114 px. Seven, so that every one of them lands
      // among each nation's first rows (i % 7 against i % 10).
      var names = ["57 mm AT M1", "AN/MPQ-34 radar", "AN/TPS-59 radar", "F-4E Phantom II", "Kurnass 2000", "F-4E AUP Phantom II", "A-26C-45DT"];
      var units = [];
      for (var i = 0; i < 450; i++) units.push({ id: "v" + i, name: names[i % 7], fullName: names[i % 7], cls: i % 2 ? "air" : "tank", country: "", tree: "country_" + tags[i % 10], rank: 1 + i % 8 });
      GameUnits.byId = new Map(units.map(function(u){ return [u.id, u]; }));
      GameDB.vehicleRows = units.map(function(u){ return { unit: u, model: u.id }; });
      GameDB.models = GameDB.vehicleRows.map(function(r){ return r.model; });
      GameDB.stems = new Map();
      ["rowGameOpen", "hintGameOpen"].forEach(function(id){ $(id).style.display = "none"; });
      ["rowGameSearch", "advGame"].forEach(function(id){ $(id).style.display = ""; });
      $("gameSearch").disabled = false;
      var skins = [];
      for (var k = 0; k < n; k++) skins.push({ name: "skin " + k, kind: "dir", units: ["v" + k], texCount: 3, mtime: 1000 - k });
      App.userSkins = skins; App.userSkinsDir = null;
      clearFilters(); renderFilterChips(); $("gameSearch").value = ""; Finder.changed();
      await frame();
    },
    // everything a check needs about the left column, in one read
    read: function(){
      var lp = $("leftPane"), gw = $("gameListWrap"), sw = $("userSkinWrap");
      var sc = scrollers($("leftbar"));
      return { view: [innerWidth, innerHeight],
        barOverflow: getComputedStyle($("leftbar")).overflowY + "/" + getComputedStyle($("rightbar")).overflowY,
        column: [lp.scrollHeight, lp.clientHeight], game: box("gameListWrap"), skins: box("userSkinWrap"),
        skinsScroll: [sw.scrollHeight, sw.clientHeight], gameScroll: [gw.scrollHeight, gw.clientHeight],
        search: box("gameSearch"), pane: box("leftPane"),
        scrollers: sc.map(function(e){ return e.id || e.className; }),
        nested: sc.filter(function(a){ return sc.some(function(b){ return b !== a && b.contains(a); }); }).map(function(e){ return e.id || e.className; }),
        gutter: gw.offsetWidth - gw.clientWidth - 2, sep: box("listSep"), sepCursor: getComputedStyle($("listSep")).cursor,
        split: Layout.listSplit(),
        // which of the Game files section's pieces are on screen — all of them unless it is folded
        shown: ["gameSearch", "gameClassRow", "rowGameSort", "gameListWrap"].filter(function(id){ return $(id).offsetParent !== null; }) };
    },
    scrollLists: async function(){ $("gameListWrap").scrollTop = 1e6; $("userSkinWrap").scrollTop = 1e6; await frame(); return box("gameSearch"); },
    // Everything in the tab that is position:sticky — which should be the search box's line alone.
    sticky: function(){
      return [].slice.call($("tabVehicle").querySelectorAll("*")).filter(function(e){ return getComputedStyle(e).position === "sticky"; })
        .map(function(e){ var r = e.getBoundingClientRect(); return { id: e.id || e.className, top: r.top, bottom: r.bottom, h: r.height, box: e.contains($("gameSearch")) }; });
    },
    // How many px of a list are in the column's view and NOT under a sticky piece stuck at its top.
    seen: function(id){
      var p = $("leftPane").getBoundingClientRect(), r = $(id).getBoundingClientRect();
      var top = Math.max(r.top, p.top), bottom = Math.min(r.bottom, p.bottom);
      window.__sb.sticky().forEach(function(s){ if (s.top <= top + 0.5 && s.bottom > top) top = s.bottom; });
      return Math.max(0, bottom - top);
    },
    // The last resort, read three ways: at the top; scrolled until the vehicle list meets the sticky
    // box; and scrolled to the end.
    scrollColumn: async function(){
      var lp = $("leftPane"), sb = window.__sb, st = sb.sticky(), h = st.length ? st[0].h : 0;
      var r = { at0: { gameSeen: sb.seen("gameListWrap") } };
      lp.scrollTop = Math.round(box("gameListWrap").top - box("leftPane").top - h); await frame();
      r.under = { by: lp.scrollTop, gameSeen: sb.seen("gameListWrap") };
      lp.scrollTop = 1e6; await frame();
      r.end = { by: lp.scrollTop, search: box("gameSearch"), pane: box("leftPane"), sticky: sb.sticky(),
                gameSeen: sb.seen("gameListWrap"), skinsSeen: sb.seen("userSkinWrap") };
      lp.scrollTop = 0; await frame();
      return r;
    },
    fold: async function(id, on){ var s = $(id); if (s.classList.contains("collapsed") !== on) s.querySelector("h3").click(); await frame(); },
    // The visible pieces of the Vehicle tab, top to bottom, must not overlap: flattening the two
    // sections and the search control (display:contents) moved their spacing onto the pieces
    // themselves — so this flattens every level of it, not only the first.
    overlaps: function(){
      var items = [];
      var flat = function(el){ [].slice.call(el.children).forEach(function(c){
        if (getComputedStyle(c).display === "contents") flat(c); else items.push(c);
      }); };
      flat($("tabVehicle"));
      items = items.filter(function(e){ return e.offsetParent !== null && e.getBoundingClientRect().height > 0; });
      var bad = [];
      for (var i = 1; i < items.length; i++) {
        var a = items[i - 1].getBoundingClientRect(), b = items[i].getBoundingClientRect();
        if (b.top < a.bottom - 0.5) bad.push((items[i - 1].id || items[i - 1].tagName) + "/" + (items[i].id || items[i].tagName) + " " + Math.round(a.bottom - b.top) + "px");
      }
      return { n: items.length, bad: bad };
    },
    // ---- the rows themselves (2026-10-10) ----
    // Every vehicle name the list drew that its row cuts short, as "name: room/needed px".
    cutNames: function(){
      return [].slice.call(document.querySelectorAll("#gameList > .rowitem .t1")).filter(function(t){ return t.scrollWidth > t.clientWidth; })
        .map(function(t){ return t.textContent + ": " + t.clientWidth + "/" + t.scrollWidth; });
    },
    names: function(){ return document.querySelectorAll("#gameList > .rowitem .t1").length; },
    nameRoom: function(){ var t = document.querySelector("#gameList > .rowitem .t1"); return t ? t.clientWidth : 0; },
    // Whole vehicle rows in view: inside the list's box and inside the column's view.
    rowsSeen: function(){
      var w = $("gameListWrap").getBoundingClientRect(), p = $("leftPane").getBoundingClientRect();
      return [].slice.call(document.querySelectorAll("#gameList > .rowitem")).filter(function(r){
        var b = r.getBoundingClientRect();
        return b.top >= Math.max(w.top, p.top) - 0.5 && b.bottom <= Math.min(w.bottom, p.bottom) + 0.5;
      }).length;
    },
    // Whether an element is wholly in the column's view.
    inView: function(el){
      var r = el.getBoundingClientRect(), p = $("leftPane").getBoundingClientRect();
      return r.height > 0 && r.top >= p.top - 0.5 && r.bottom <= p.bottom + 0.5;
    },
    reach: function(){ var sb = window.__sb; return { head: sb.inView($("secSkin").querySelector("h3")), button: sb.inView($("btnLoadSkin")) }; },
    // Each folded Vehicle-tab heading's bottom margin: a folded section is its heading alone, so the
    // stylesheet zeroes it, and an id-scoped rule that set it again outranked that (review, 2026-10-10).
    foldGaps: function(){ return [].map.call(document.querySelectorAll("#tabVehicle > .section.collapsed > h3"), function(h){ return h.parentNode.id + " " + getComputedStyle(h).marginBottom; }); },
    // The type sizes a vehicle row's two lines are drawn at, so a denser short page is seen to be
    // denser in its padding and not in its text.
    type: function(){ var r = document.querySelector("#gameList > .rowitem"); if (!r) return ""; var cs = function(s){ return getComputedStyle(r.querySelector(s)).fontSize; };
      return cs(".t1") + "/" + cs(".t2") + " in " + Math.round(r.getBoundingClientRect().height * 10) / 10 + " px"; },
    // WCAG 2 contrast of an element's colour over the ground painted under it, every opacity on the
    // way up included — how the review measured the download icon at 2.4:1. PROP is the colour that
    // paints it: "stroke" for a drawn icon, whose own opacity is then in the chain too.
    contrast: function(el, prop){
      // (inside this template literal a regex's backslashes are written twice)
      var parse = function(s){ var m = /rgba?\\(([^)]+)\\)/.exec(s); if (!m) return null; var p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
      var lin = function(v){ v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      var lum = function(c){ return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b); };
      var over = function(f, b, a){ return { r: f.r * a + b.r * (1 - a), g: f.g * a + b.g * (1 - a), b: f.b * a + b.b * (1 - a) }; };
      var chain = []; for (var e = el; e; e = e.parentElement) chain.push(e);
      var bg = { r: 0, g: 0, b: 0 }, op = 1;
      for (var i = chain.length - 1; i >= 0; i--) { var c = parse(getComputedStyle(chain[i]).backgroundColor); if (c && c.a > 0) bg = over(c, bg, c.a); }
      chain.forEach(function(x){ op *= parseFloat(getComputedStyle(x).opacity); });
      var fg = parse(getComputedStyle(el)[prop || "color"]), a = lum(over(fg, bg, fg.a * op)), b = lum(bg);
      return Math.round((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) * 100) / 100;
    },
    // The icon itself, not its button: the svg carries class vico, whose opacity .85 the button never sees
    // (a check of the button read 4.67 while the stroke drew at 3.79).
    icon: function(){ var m = document.querySelector("#gameList > .rowitem .more svg"); return m ? window.__sb.contrast(m, "stroke") : 0; },
    // A dialog of choice rows (welcome.js choiceDialog): the vehicle row dropped its hover-only "Load"
    // label, and these rows keep theirs — accent, 11 px, shown under the pointer only.
    goRow: function(){
      choiceDialog("t102", [{ list: true, label: "A choice", sub: "its line", go: "Choose", value: 1 }, { label: "Cancel", value: null }]);
      var ov = document.body.lastElementChild, g = ov.querySelector(".rowitem .go");
      var p = document.createElement("span"); p.style.color = "var(--accent)"; document.body.appendChild(p); var acc = getComputedStyle(p).color; p.remove();
      if (!g) return { found: false };
      var r = g.parentElement.getBoundingClientRect(), cs = getComputedStyle(g);
      return { found: true, opacity: cs.opacity, size: cs.fontSize, accent: cs.color === acc, color: cs.color, at: { x: Math.round(r.left + r.width / 3), y: Math.round(r.top + r.height / 2) } };
    },
    goHover: function(){ return new Promise(function(r){ setTimeout(r, 400); }).then(function(){ var g = document.body.lastElementChild.querySelector(".rowitem .go"), o = getComputedStyle(g).opacity;
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); return o; }); },
    firstRow: function(){ var r = document.querySelector("#gameList > .rowitem").getBoundingClientRect(); return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) }; },
    // The nation and rank rows, and the chip they fold behind on a short page.
    filters: function(){
      var t = $("gameMoreFilters"), shown = function(id){ return $(id).offsetParent !== null; };
      var r = t && t.offsetParent ? t.getBoundingClientRect() : null;
      return { toggle: !!r, expanded: t ? t.getAttribute("aria-expanded") : null, nation: shown("gameNationRow"), rank: shown("gameRankRow"),
        at: r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null,
        classLines: [].filter.call($("gameClassRow").querySelectorAll(".chipline"), function(l){ return l.offsetHeight > 0; }).length,
        on: t ? t.classList.contains("on") : false, flag: t && t.querySelector("svg.flag") ? t.querySelector("svg.flag").getAttribute("aria-label") : "", label: t ? t.textContent : "" };
    },
    right: function(){
      var rp = $("rightPane"), sc = scrollers($("rightbar"));
      return { scrollers: sc.map(function(e){ return e.id || e.className; }), view: $("secView").parentElement.id,
        kids: [].map.call($("rightbar").children, function(c){ return c.id || c.className; }),
        loose: [].filter.call(document.querySelectorAll("#rightbar .section"), function(x){ return !$("rightPane").contains(x); }).length,
        rightbar: [$("rightbar").scrollHeight, $("rightbar").clientHeight], pane: [rp.scrollHeight, rp.clientHeight],
        gutter: rp.offsetWidth - rp.clientWidth };
    },
  };
  return true;
})()`;

// A real drag on the bar: Chrome turns CDP mouse events into trusted pointer events, which is what
// setPointerCapture in Layout.drag needs — a synthetic PointerEvent cannot take capture.
async function drag(cdp, x, y, dy){
  const m = (type, yy, extra) => cdp.send("Input.dispatchMouseEvent", Object.assign({ type, x, y: yy, button: "left", buttons: 1, clickCount: 1 }, extra || {}));
  await m("mouseMoved", y, { buttons: 0, button: "none" });
  await m("mousePressed", y);
  for (let k = 1; k <= 6; k++) await m("mouseMoved", y + dy * k / 6);
  await m("mouseReleased", y + dy, { buttons: 0 });
}
async function dblclick(cdp, x, y){
  for (const clickCount of [1, 2]) {
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount });
  }
}

async function big(){
  return evalInPage({ browser, chromeArgs: ["--window-size=1920,1080"], expr: "1", timeoutMs: 90000, drive: async ({ cdp, evaluate }) => {
    const o = {};
    await evaluate(HELPERS, 30000);
    o.boot = await evaluate("__sb.boot()");
    await evaluate("__sb.setup(30)");
    o.a = await evaluate("__sb.read()");
    o.a.searchAfterLists = await evaluate("__sb.scrollLists()");
    o.a.overlaps = await evaluate("__sb.overlaps()");
    // the rows: every name whole, the download icon legible at rest, under the pointer and selected
    await evaluate("(function(){ document.getElementById('gameListWrap').scrollTop = 0; return __sb.frame(); })()");
    o.rows = await evaluate("({ cut: __sb.cutNames(), n: __sb.names(), room: __sb.nameRoom(), fold: __sb.filters(), type: __sb.type() })");
    o.icon = { rest: await evaluate("__sb.icon()") };
    const fr = await evaluate("__sb.firstRow()");
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: fr.x, y: fr.y, button: "none", buttons: 0 });
    o.icon.hover = await evaluate("__sb.frame().then(function(){ return __sb.icon(); })");
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2, button: "none", buttons: 0 });
    o.icon.sel = await evaluate("__sb.frame().then(function(){ var r = document.querySelector('#gameList > .rowitem'); r.classList.add('sel'); var c = __sb.icon(); r.classList.remove('sel'); return c; })");
    o.go = await evaluate("__sb.frame().then(function(){ return __sb.goRow(); })");
    if (o.go.found) {
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: o.go.at.x, y: o.go.at.y, button: "none", buttons: 0 });
      o.go.hover = await evaluate("__sb.goHover()");
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2, button: "none", buttons: 0 });
      o.go.closed = await evaluate("__sb.frame().then(function(){ return !document.querySelector('.rowitem .go'); })");
    }
    // the bar, dragged 60 px down with the real mouse
    const s = o.a.sep, x = Math.round(s.left + s.width / 2), y = Math.round(s.top + s.h / 2);
    await drag(cdp, x, y, 60);
    o.dragged = await evaluate("__sb.frame().then(function(){ return __sb.read(); })");
    await dblclick(cdp, x, Math.round(o.dragged.sep.top + o.dragged.sep.h / 2));
    o.reset = await evaluate("__sb.frame().then(function(){ return __sb.read(); })");
    // folding either section gives its height to the other list
    await evaluate("__sb.fold('secSkin', true)");
    o.skinsFolded = await evaluate("__sb.read()");
    await evaluate("__sb.fold('secSkin', false).then(function(){ return __sb.fold('secGame', true); })");
    o.gameFolded = await evaluate("__sb.read()");
    await evaluate("__sb.fold('secGame', false)");
    // a short skins list is held at its own rows
    await evaluate("__sb.setup(2)");
    o.short = await evaluate("__sb.read()");
    o.right = await evaluate("__sb.right()");
    return o;
  } });
}
// A window too short for the tab's floor: `w x h` is the window, as --window-size takes it (the page
// is 16 px narrower and 151 px shorter in this Chrome — 1366 x 791 gives the 1350 x 640 page of a
// maximized 1366 x 768 laptop, which is where the review of 2026-09-27 measured the last resort).
async function short(w, h){
  return evalInPage({ browser, chromeArgs: ["--window-size=" + w + "," + h], expr: "1", timeoutMs: 90000, drive: async ({ evaluate }) => {
    await evaluate(HELPERS, 30000);
    await evaluate("__sb.setup(30)");
    const o = await evaluate("__sb.read()");
    o.sticky = await evaluate("__sb.sticky()");
    o.rows = await evaluate("({ cut: __sb.cutNames(), n: __sb.names(), room: __sb.nameRoom(), seen: __sb.rowsSeen(), reach: __sb.reach(), fold: __sb.filters() })");
    o.afterColumn = await evaluate("__sb.scrollColumn()");
    o.overlaps = await evaluate("__sb.overlaps()");
    return o;
  } });
}
// A page of exactly w x h, set through the protocol rather than a window size — the sizes the review
// of 2026-10-10 measured at, 1366 x 768 among them. Also where the fold is driven the way a person
// drives it: a real click, then Enter and Space on the focused chip.
async function exact(w, h){
  return evalInPage({ browser, expr: "1", timeoutMs: 90000, drive: async ({ cdp, evaluate }) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await evaluate(HELPERS, 30000);
    await evaluate("__sb.setup(30)");
    const o = await evaluate("__sb.read()");
    o.rows = await evaluate("({ cut: __sb.cutNames(), n: __sb.names(), room: __sb.nameRoom(), seen: __sb.rowsSeen(), reach: __sb.reach() })");
    o.fold = await evaluate("__sb.filters()");
    const click = async (x, y) => {
      for (const type of ["mousePressed", "mouseReleased"])
        await cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
      return evaluate("__sb.frame().then(function(){ return __sb.filters(); })");
    };
    const key = async (k, code, vk, text) => {
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, text });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
      return evaluate("__sb.frame().then(function(){ return __sb.filters(); })");
    };
    if (o.fold.at) {
      o.clicked = await click(o.fold.at.x, o.fold.at.y);
      o.clickedBack = await click(o.fold.at.x, o.fold.at.y);
      await evaluate("document.getElementById('gameMoreFilters').focus()");
      o.enter = await key("Enter", "Enter", 13, "\r");
      o.space = await key(" ", "Space", 32, " ");
      // a nation picked (from the chip itself, folded away) shows on the chip that hides it
      o.lit = await evaluate("(function(){ var g = [].filter.call(document.querySelectorAll('#gameNationRow .chip'), function(c){ return c.title.indexOf('germany') === 0; })[0]; g.click(); return __sb.frame().then(function(){ var f = __sb.filters(); g = [].filter.call(document.querySelectorAll('#gameNationRow .chip'), function(c){ return c.title.indexOf('germany') === 0; })[0]; g.click(); return __sb.frame().then(function(){ f.after = __sb.filters(); return f; }); }); })()");
    }
    o.overlaps = await evaluate("__sb.overlaps()");
    return o;
  } });
}
// The short pages the final audit of 2026-10-10 counted three whole rows and a cut fourth at, each
// set exactly over the protocol in one window, the search set up again at each size. Then each
// section folded on a short page, and the bar on a short page that leaves it something to share: a
// maximized 1440 x 900 laptop's page.
async function laptops(sizes, folds){
  return evalInPage({ browser, expr: "1", timeoutMs: 90000, drive: async ({ cdp, evaluate }) => {
    const o = { at: {} };
    const size = async (w, h) => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      if (!o.ready) { await evaluate(HELPERS, 30000); o.ready = true; }
      await evaluate("__sb.setup(30)");
      return evaluate("__sb.read()");
    };
    for (const [w, h] of sizes) {
      const r = await size(w, h);
      r.rows = await evaluate("({ cut: __sb.cutNames(), room: __sb.nameRoom(), seen: __sb.rowsSeen(), reach: __sb.reach(), type: __sb.type(), fold: __sb.filters().toggle })");
      r.overlaps = await evaluate("__sb.overlaps()");
      o.at[w + "x" + h] = r;
    }
    o.folded = {};
    for (const [w, h] of folds) {
      await size(w, h);
      const f = {};
      f.skin = await evaluate("__sb.fold('secSkin', true).then(function(){ var r = __sb.read(); r.gaps = __sb.foldGaps(); return r; })");
      f.game = await evaluate("__sb.fold('secSkin', false).then(function(){ return __sb.fold('secGame', true); }).then(function(){ var r = __sb.read(); r.gaps = __sb.foldGaps(); return r; })");
      await evaluate("__sb.fold('secGame', false)");
      o.folded[w + "x" + h] = f;
    }
    // Dragged UP, because a list near its floor has more room to give than to take, and because up
    // is the direction a drag that ignored the floors gets wrong: Layout.baseOf returning 0 moves
    // the boundary 5 px DOWN here for a 12 px drag up.
    const before = await size(1440, 790), s = before.sep;
    await drag(cdp, Math.round(s.left + s.width / 2), Math.round(s.top + s.h / 2), -12);
    o.dragged = { before, after: (await evaluate("__sb.frame().then(function(){ return __sb.read(); })")).game.h };
    return o;
  } });
}

const rb = await big();
if (!rb.ok) { console.log("FAIL: " + rb.reason); process.exit(1); }
const B = rb.result, A = B.a;
const px = v => Math.round(v);
const inside = (el, pane) => el.top >= pane.top - 0.5 && el.bottom <= pane.top + pane.h + 0.5;

console.log(`\n=== ${A.view.join(" x ")}: the column stands still, the lists scroll ===`);
R.is(B.boot.gameEmpty && !B.boot.skinsShown && B.boot.sep === "auto",
  "at boot the vehicle pane is a hint that takes no share, there is no skins pane, and the bar is not a handle");
R.is(A.barOverflow === "hidden/hidden", `neither sidebar scrolls itself (${A.barOverflow})`);
R.is(A.column[0] <= A.column[1] + 1, `the left column's pane has nothing to scroll at this size (${A.column.join(" / ")} px)`);
R.is(A.scrollers.join() === "gameListWrap,userSkinWrap" && A.nested.length === 0,
  `the two result lists are the only scrollers in the column, and neither is inside another (${A.scrollers.join(", ")})`);
R.is(inside(A.search, A.pane) && px(A.searchAfterLists.top) === px(A.search.top),
  `the search box is in view, and stays put when both lists are scrolled to their ends (${px(A.search.top)} → ${px(A.searchAfterLists.top)} px)`);
R.is(A.overlaps.bad.length === 0, A.overlaps.bad.length ? "pieces of the tab overlap: " + A.overlaps.bad.join(", ") : `none of the tab's ${A.overlaps.n} pieces overlaps the next`);
R.is(A.gutter === 6, `a pane's scrollbar is 6 px (${A.gutter})`);

// The review of 2026-10-10, in real Chrome on the real install: every name was cut to 4-7 characters
// ("F-4E Ph…") because a row gave its name 53 px of 191 — a "Load ▸" label invisible until hover
// still took 36 px and a gap, and a flag repeated the nation the second line already says. The
// download icon was the muted colour at opacity .55, 2.4:1, and read as disabled.
console.log("\n=== the rows: whole names and a download icon that reads as live ===");
R.is(B.rows.n >= 7 && B.rows.cut.length === 0,
  `every one of the ${B.rows.n} vehicle names the list drew is whole — ${B.rows.room} px of room (the review measured 53)${B.rows.cut.length ? "; cut: " + B.rows.cut.slice(0, 4).join(", ") : ""}`);
R.is(B.icon.rest >= 4.5 && B.icon.hover >= 4.5 && B.icon.sel >= 4.5,
  `the download icon, its own stroke and opacity, is at least 4.5:1 on its row at rest, under the pointer and selected (${B.icon.rest}, ${B.icon.hover}, ${B.icon.sel}; was 2.41, 2.25 and 1.47)`);
R.is(B.go.found && B.go.opacity === "0" && B.go.size === "11px" && B.go.accent && B.go.hover === "1" && B.go.closed,
  `a dialog's choice row keeps its own "Choose" label hidden until the pointer is on it, in the accent at 11 px — the vehicle row dropped that label, these did not (opacity ${B.go.opacity} → ${B.go.hover} hovered, ${B.go.size}, ${B.go.color})`);
R.is(!B.rows.fold.toggle && B.rows.fold.nation && B.rows.fold.rank,
  `on a page this tall the nation and rank chips are all shown and there is no chip folding them away`);

console.log("\n=== the two lists share the height ===");
const share = A.game.h / (A.game.h + A.skins.h);
R.is(Math.abs(share - .6) < .03 && A.split === .6, `3:2 by default — the vehicle list has ${(share * 100).toFixed(1)} % of the two (${px(A.game.h)} / ${px(A.skins.h)} px)`);
const handed = A.skins.h - B.short.skins.h;
R.is(B.short.skinsScroll[0] <= B.short.skinsScroll[1] + 1 && handed > 10 && Math.abs(B.short.game.h - A.game.h - handed) <= 2,
  `a two-skin list is held at its own rows (${B.short.skinsScroll.join(" / ")} px) and every pixel it does not use goes to the vehicles (+${px(B.short.game.h - A.game.h)} of ${px(handed)} px)`);
const gain = B.skinsFolded.game.h - A.game.h;
R.is(B.skinsFolded.skins.h === 0 && gain >= A.skins.h && B.skinsFolded.column[0] <= B.skinsFolded.column[1] + 1 && B.skinsFolded.sepCursor === "auto",
  `folding "Existing skin" gives its height to the vehicle list (+${px(gain)} px), and the bar stops being a handle`);
R.is(B.gameFolded.game.h === 0 && B.gameFolded.skins.h > A.skins.h + 100, `folding "Game files" gives it to the skins list (${px(A.skins.h)} → ${px(B.gameFolded.skins.h)} px)`);
// The search control's pieces are laid out as the tab's own (display:contents), and an id selector
// outranks the folding rule — so folding has to be seen to hide the box, the chips and the sort too.
R.is(A.shown.length === 4 && B.gameFolded.shown.length === 0,
  `and folds away the search box, the chips and the sort with the list (on screen open: ${A.shown.join(", ")}; folded: ${B.gameFolded.shown.join(", ") || "none"})`);

console.log("\n=== the bar between them ===");
const moved = B.dragged.game.h - A.game.h;
R.is(A.sepCursor === "row-resize", "with both lists showing rows the bar is a handle (row-resize)");
R.is(Math.abs(moved - 60) <= 4 && B.dragged.split > .6, `dragged 60 px with the mouse, the boundary follows the cursor (+${px(moved)} px, split ${B.dragged.split})`);
R.is(B.reset.split === .6 && Math.abs(B.reset.game.h - A.game.h) <= 2, `a double-click puts the stylesheet's split back (${B.reset.split}, ${px(B.reset.game.h)} px)`);

console.log("\n=== the right column ===");
const RT = B.right;
R.is(RT.rightbar[0] <= RT.rightbar[1] + 1 && RT.scrollers.join() === (RT.pane[0] > RT.pane[1] + 1 ? "rightPane" : ""),
  `it never scrolls itself; its one pane does (${RT.pane.join(" / ")} px, scrollers: ${RT.scrollers.join(", ") || "none"})`);
R.is(RT.view === "rightPane", `View & scene is docked into that pane, not after it (${RT.view})`);
R.is(RT.kids.join() === "rightPane" && RT.loose === 0,
  `the pane is the column's only child and every section is inside it — a section added beside it would sit out of the scroll (${RT.kids.join(", ")}; ${RT.loose} outside)`);
R.is(RT.gutter === 0 || RT.gutter === 6, `and its scrollbar is the thin one when it has one (${RT.gutter} px)`);

// The last resort, at a maximized 1366 x 768 laptop's page (the review's evidence) and at a shorter one.
// Before the review's fix both lists were squeezed to their 64 px minimum there — 1.3 rows of a list
// that holds 3 882 vehicles — and the whole 219 px search control was the sticky part, so scrolling
// the column slid the vehicle list under it: 36 of its 64 px were left in view.
for (const [w, h] of [[1366, 791], [1280, 720]]) {
  const rs = await short(w, h);
  if (!rs.ok) { console.log("FAIL: " + rs.reason); process.exit(1); }
  const S = rs.result, C = S.afterColumn;
  console.log(`\n=== ${S.view.join(" x ")}: too short for the tab's floor ===`);
  R.is(S.column[0] > S.column[1] && S.game.h >= 209 && S.skins.h >= 63,
    `the column scrolls as a last resort (${S.column.join(" / ")} px) rather than squeezing a list below its floor: the vehicle list keeps at least the 210 px box it had before 3.6, the skins list one row (${px(S.game.h)} / ${px(S.skins.h)} px)`);
  // The final audit of 2026-10-10 counted three whole rows and a cut fourth on this page: a 210 px
  // floor of 48 px rows 4 apart under a 27 px "Vehicles · 450" label. On the shorter page the floor
  // gives way before the "Existing skin" heading does (at most the page less 330 px).
  if (w === 1366) R.is(S.rows.seen >= 5,
    `and on the laptop that floor holds five whole vehicle rows (${S.rows.seen} in ${px(S.game.h)} px; three and a cut fourth at 210 px before)`);
  else R.is(S.rows.seen >= 4 && S.rows.reach.head,
    `and on a page this short the list gives way before the "Existing skin" heading does: ${S.rows.seen} whole rows in ${px(S.game.h)} px, the heading in view at the top (${S.rows.reach.head})`);
  R.is(S.sticky.length === 1 && S.sticky[0].box && S.sticky[0].h < 60,
    `the sticky part is the search box's own line and nothing else (${S.sticky.map(s => s.id + " " + px(s.h) + " px").join(", ")}), so scrolling the column slides no list under a taller block`);
  // A column shorter than the furniture above the list plus the list cannot show both at the top; the
  // laptop's can, and has to — that is the view main had there, a 210 px list under the chips.
  if (w === 1366) R.is(C.at0.gameSeen >= S.game.h - 1,
    `at the top of the column the whole vehicle list is in view with the box, the chips and the sort (${px(C.at0.gameSeen)} of ${px(S.game.h)} px)`);
  R.is(C.under.by > 0 && C.under.gameSeen >= S.game.h - 1,
    `scrolled ${C.under.by} px, until the list meets the box, all of it is in view and none of it under the box (${px(C.under.gameSeen)} of ${px(S.game.h)} px)`);
  R.is(C.end.by > 0 && inside(C.end.search, C.end.pane) && C.end.skinsSeen >= S.skins.h - 1,
    `scrolled to its end (${C.end.by} px), the search box is still in view and so is the whole skins list (${px(C.end.search.top)} px, the pane starts at ${px(C.end.pane.top)}; ${px(C.end.skinsSeen)} of ${px(S.skins.h)} px)`);
  if (w === 1366) R.is(C.end.gameSeen >= 0.9 * S.game.h,
    `and on the laptop the vehicle list is still in view there, not under the box — ${px(C.end.gameSeen)} of ${px(S.game.h)} px, where the review measured 36 of 64`);
  R.is(S.overlaps.bad.length === 0, S.overlaps.bad.length ? "pieces of the tab overlap: " + S.overlaps.bad.join(", ") : `none of the tab's ${S.overlaps.n} pieces overlaps the next`);
  R.is(S.rows.cut.length === 0, `with the column's scrollbar taking its share, every vehicle name is still whole (${S.rows.room} px of room)${S.rows.cut.length ? "; cut: " + S.rows.cut.slice(0, 4).join(", ") : ""}`);
  // The review measured the whole of Existing skin below the fold at 1366 x 650 and 1280 x 600: the
  // nation and rank chips (two rows each) took the room. Folded behind one chip, they give it back.
  if (w === 1366) R.is(S.rows.reach.head && S.rows.reach.button,
    `at the top of the column "Existing skin" and its Load a skin… button are in view without scrolling (heading ${S.rows.reach.head}, button ${S.rows.reach.button})`);
}

// A 1366 x 768 page — the review's laptop page, 664 px of column. The tab needed 705, so the column
// scrolled and the vehicle list sat at its 210 px floor, three rows; and a plain 3:2 share of the room
// the fold frees would have handed all of it to the skins list, because the vehicle list's share
// (60 % of 324 px) was still under its floor.
{
  const re = await exact(1366, 768);
  if (!re.ok) { console.log("FAIL: " + re.reason); process.exit(1); }
  const E = re.result;
  console.log(`\n=== ${E.view.join(" x ")}: the nation and rank chips fold, and the vehicle list gets the room ===`);
  R.is(E.fold.toggle && !E.fold.nation && !E.fold.rank && E.fold.expanded === "false",
    `the nation and rank rows are folded behind one chip (${JSON.stringify(E.fold.label)}, aria-expanded ${E.fold.expanded})`);
  R.is(E.fold.classLines === 2, `which sits on the type row's own second line and costs no line of its own (${E.fold.classLines} lines)`);
  R.is(E.rows.seen >= 5 && E.column[0] <= E.column[1] + 1,
    `the whole tab fits the column (${E.column.join(" / ")} px) and the vehicle list shows ${E.rows.seen} whole rows (${px(E.game.h)} px; three at its 210 px floor before the fold, four after it)`);
  R.is(E.rows.cut.length === 0, `every vehicle name is whole (${E.rows.room} px of room)`);
  R.is(E.clicked && E.clicked.nation && E.clicked.rank && E.clicked.expanded === "true" && !E.clickedBack.nation && E.clickedBack.expanded === "false",
    `a click on the chip shows both rows and a second click folds them again (aria-expanded ${E.clicked && E.clicked.expanded} → ${E.clickedBack && E.clickedBack.expanded})`);
  R.is(E.enter && E.enter.nation && E.enter.expanded === "true" && E.space && !E.space.nation && E.space.expanded === "false",
    `and from the keyboard, Enter opens it and Space folds it (${E.enter && E.enter.expanded}, ${E.space && E.space.expanded})`);
  R.is(E.fold.flag === "Nation" && E.fold.label === "Rank" && E.lit && E.lit.on && E.lit.flag === "Germany" && !E.lit.after.on && E.lit.after.flag === "Nation",
    `a nation picked while the rows are folded lights the chip and puts its flag on it, so a filter is never out of sight (${E.fold.flag} + ${JSON.stringify(E.fold.label)} → ${E.lit && E.lit.flag}, lit ${E.lit && E.lit.on}), and clearing it puts the plain flag back`);
  R.is(E.clicked && E.clicked.at && E.fold.at && E.clicked.at.x === E.fold.at.x && E.clicked.at.y === E.fold.at.y && E.clicked.classLines === 2,
    `opening the rows makes the column scroll, and the chip stays where it was under the pointer (${E.fold.at && E.fold.at.x + "," + E.fold.at.y} → ${E.clicked && E.clicked.at && E.clicked.at.x + "," + E.clicked.at.y}; the type row ${E.clicked && E.clicked.classLines} lines)`);
  R.is(E.overlaps.bad.length === 0, E.overlaps.bad.length ? "pieces of the tab overlap: " + E.overlaps.bad.join(", ") : `none of the tab's ${E.overlaps.n} pieces overlaps the next`);
}

// The short pages of the final audit of 2026-10-10 — 1366 x 650 and 1280 x 600, and 592, the 1280 x
// 720 laptop's page — where the vehicle list sat at its 210 px floor: three whole rows and a cut
// fourth, the owner's "at 730 px tall or less the vehicle list shows 3 rows". On a page this short
// the column scrolls anyway, so the floor IS the list; it holds five rows now, of the same type in 4
// px less padding, as long as the "Existing skin" heading still fits a column that is not scrolled.
{
  const SIZES = [[1366, 650], [1280, 600], [1280, 592]], FOLDS = [[1280, 600], [1280, 592], [1366, 768]];
  const rl = await laptops(SIZES, FOLDS);
  if (!rl.ok) { console.log("FAIL: " + rl.reason); process.exit(1); }
  const L = rl.result;
  for (const [w, h] of SIZES) {
    const P = L.at[w + "x" + h];
    console.log(`\n=== ${P.view.join(" x ")}: five vehicle rows on a short page ===`);
    R.is(P.rows.fold && P.rows.seen >= 5,
      `the vehicle list shows ${P.rows.seen} whole rows (${px(P.game.h)} px; three and a cut fourth at its 210 px floor before)`);
    R.is(P.rows.reach.head,
      `and the "Existing skin" heading is still in view at the top of the column, not scrolled (${P.rows.reach.head}${P.rows.reach.button ? ", its Load a skin… button too" : "; its Load a skin… button is below the fold"})`);
    R.is(P.rows.type.split(" in ")[0] === B.rows.type.split(" in ")[0] && P.rows.cut.length === 0,
      `the rows are denser in their padding, not their type: names and their second line at ${P.rows.type} (a tall page: ${B.rows.type}), every name whole in ${P.rows.room} px`);
    R.is(P.overlaps.bad.length === 0, P.overlaps.bad.length ? "pieces of the tab overlap: " + P.overlaps.bad.join(", ") : `none of the tab's ${P.overlaps.n} pieces overlaps the next`);
  }
  // A section folded on a short page (the review of this change, 2026-10-10). A folded section is its
  // heading alone, and the stylesheet gives that heading no bottom margin; the short page's 6 px
  // heading rule, scoped by id, outranked it, so folding "Existing skin" at 1280 x 600 left the column
  // 5 px too tall (501 / 496) where it had fitted (496 / 496) with the old 210 px floor. At 592, where
  // the floor is the page less 330, the tab's 10 px foot under that heading left 3 px (491 / 488).
  for (const [w, h] of FOLDS) {
    const F = L.folded[w + "x" + h], gaps = [...F.skin.gaps, ...F.game.gaps];
    console.log(`\n=== ${F.skin.view.join(" x ")}: a section folded on a short page ===`);
    R.is(F.skin.skins.h === 0 && F.skin.column[0] <= F.skin.column[1] + 1,
      `folding "Existing skin" hands its room to the vehicle list and the whole tab fits the column (${F.skin.column.join(" / ")} px, the vehicle list ${px(F.skin.game.h)} px)`);
    R.is(gaps.length === 2 && gaps.every(g => / 0px$/.test(g)),
      `a folded heading has no bottom margin here either, whichever section is folded (${gaps.join(", ")})`);
  }
  // Moved here from the 1366 x 768 page, where five rows leave the two lists 12 px above their floors
  // to share; this page leaves 34. With Layout.baseOf returning 0 the drag reads the vehicle list's
  // whole height as its share, and the boundary moves 5 px down for a 12 px drag up.
  const D = L.dragged, moved = D.after - D.before.game.h;
  console.log(`\n=== ${D.before.view.join(" x ")}: the bar on a short page ===`);
  R.is(D.before.sepCursor === "row-resize" && D.before.column[0] <= D.before.column[1] + 1 && Math.abs(moved + 12) <= 1,
    `the bar still follows the cursor where both lists start from their floors: dragged 12 px up, the boundary moves ${px(moved)} px (${px(D.before.game.h)} → ${px(D.after)} px)`);
}
R.finish();
