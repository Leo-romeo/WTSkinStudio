// Every slider's value can be typed, every slider shows its value, and the panels stay readable.
//
// WHY THIS EXISTS. Until 2026-09-25 a value could only be dragged — "exactly 64 px", "the same 35 %
// as on the other layer" meant nudging with the arrow keys and watching the number — and only the two
// Rotate rows had a box to type in. Five sliders (the decal's Brightness / Contrast / Saturation and
// the light's two angles) did not show their value at all. The fix is one delegated handler in
// ui/dom.js (`sliderTyping`): click a slider's number, or press Enter on the slider, type, Enter.
//
// The number is typed in the units the READOUT shows. Most readouts are the raw value; four are not
// (projDepth stores 300 and shows "3.0×"), and those declare the factor as `data-k`. A slider added
// later with a scaled readout and no `data-k` would take "3" as raw 3 — the check that reads every
// readout against value × k is what stops that, and it was proved to fail by deleting projDepth's
// `data-k`, which it names.
//
// What is held, in the real page:
//   * every slider in the page has a readout or a number box after it;
//   * every readout opens a box showing value × k, and Esc puts everything back untouched;
//   * each readout agrees with its slider at load, and after the slider moves, within one displayed
//     digit — i.e. `data-k` is right wherever a readout is scaled;
//   * typing 120 sets 120 with one `input` and one `change` (so one undo step, from the slider's own
//     handlers); 9999 clamps to the max; junk and Esc change nothing and fire nothing; "1,5" is 1.5;
//     a click away keeps what was typed; Enter on the focused slider opens its box, and a second
//     Enter while it is open does not lose the readout;
//   * a slider built after load, the way the panels build theirs, is covered with no opt-in.
// And, from the sources, the readability floor this was part of:
//   * no text below 11 px anywhere in the UI (54 places were 9–10.5 px on 2026-09-25);
//   * no tooltip over 300 characters and no always-visible panel hint over 200 — 39 tooltips ran to
//     250–507 characters and were cut to what a user needs to act on.
//
// Usage: node tools/t88_typein.mjs [--keep] [--chrome <path>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const R = makeReport();

// ---- the sources: font sizes and text lengths ----
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { if (f !== "vendor" && f !== "codecs") walk(p); }
    else if (/\.(js|html|css)$/.test(f)) files.push(p);
  }
})(path.join(ROOT, "src"));
const rel = p => path.relative(ROOT, p).split(path.sep).join("/");
const small = [], longTitles = [], longHints = [];
const plain = s => s.replace(/&#?\w+;/g, "x").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  for (const m of s.matchAll(/(?:font-size|--row-t\d)\s*:\s*(\d+(?:\.\d+)?)px/g))
    if (+m[1] < 11) small.push(`${rel(f)}: ${m[0]}`);
  for (const m of s.matchAll(/title="([^"]*)"/g))
    if (plain(m[1]).length > 300) longTitles.push(`${rel(f)}: ${plain(m[1]).length} — ${plain(m[1]).slice(0, 60)}…`);
  for (const m of s.matchAll(/<div class="hint"[^>]*>([\s\S]*?)<\/div>/g))
    if (plain(m[1]).length > 200) longHints.push(`${rel(f)}: ${plain(m[1]).length} — ${plain(m[1]).slice(0, 60)}…`);
}
R.is(small.length === 0, small.length ? "text below 11 px: " + small.slice(0, 6).join(" | ") : `no text below 11 px in ${files.length} source files`);
R.is(longTitles.length === 0, longTitles.length ? "tooltips over 300 characters: " + longTitles.join(" | ") : "no tooltip over 300 characters");
R.is(longHints.length === 0, longHints.length ? "panel hints over 200 characters: " + longHints.join(" | ") : "no panel hint over 200 characters");

// ---- the page ----
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP (page half): no Chrome or Edge found. Pass --chrome <path> or set CHROME."); R.finish(); }

const BODY = `async function(){
  var out = {};
  var num = function(s){ var m = String(s).replace(/\\u2212/g, "-").replace(",", ".").match(/-?(\\d+\\.?\\d*|\\.\\d+)/); return m ? parseFloat(m[0]) : NaN; };
  var key = function(el, code){ el.dispatchEvent(new KeyboardEvent("keydown", { code: code, bubbles: true, cancelable: true })); };
  var box = function(){ return document.querySelector("input.valedit"); };
  var open = function(v){ v.click(); return box(); };
  var readoutOf = function(r){
    for (var e = r.nextElementSibling; e; e = e.nextElementSibling) {
      if (e.tagName === "INPUT" && e.type === "range") return null;
      if (e.classList.contains("val")) return e;
    }
    return null;
  };
  var K = function(r){ return +(r.dataset.k || 1); };
  // Agreement within one displayed digit, or one step, whichever is coarser: "1.5" for 153 × 0.01.
  var agrees = function(r, text){
    var d = num(text); if (!isFinite(d)) return true;               // "off" says nothing numeric
    var dec = (String(text).match(/\\.(\\d+)/) || ["", ""])[1].length;
    var tol = Math.max((+r.step || 1) * K(r), Math.pow(10, -dec)) * 1.01;
    return Math.abs(d - (+r.value) * K(r)) <= tol;
  };

  var ranges = Array.from(document.querySelectorAll("input[type=range]"));
  out.total = ranges.length;
  out.bare = ranges.filter(function(r){ return !readoutOf(r); }).map(function(r){ return r.id || "(no id)"; });
  var spans = ranges.map(function(r){ return [r, readoutOf(r)]; }).filter(function(p){ return p[1] && p[1].tagName === "SPAN"; });
  out.spans = spans.length;

  // readouts against value × k, at load and after the slider moves
  out.loadBad = []; out.movedBad = []; out.moved = 0;
  spans.forEach(function(p){
    var r = p[0], v = p[1];
    if (!agrees(r, v.textContent)) out.loadBad.push(r.id + " shows " + v.textContent + " for " + r.value + " x " + K(r));
    var was = r.value, shown = v.textContent, lo = +r.min, hi = +r.max;
    r.value = String(lo + (hi - lo) * 0.37);
    r.dispatchEvent(new Event("input", { bubbles: true }));
    if (v.textContent !== shown) { out.moved++; if (!agrees(r, v.textContent)) out.movedBad.push(r.id + " shows " + v.textContent + " for " + r.value + " x " + K(r)); }
    r.value = was; r.dispatchEvent(new Event("input", { bubbles: true }));
  });

  // every readout opens a box with value × k, and Esc puts it all back
  out.openBad = [];
  spans.forEach(function(p){
    var r = p[0], v = p[1], was = r.value;
    var ed = open(v);
    if (!ed) { out.openBad.push(r.id + ": no box"); return; }
    if (Math.abs(num(ed.value) - was * K(r)) > 1e-6) out.openBad.push(r.id + ": box says " + ed.value + " for " + was + " x " + K(r));
    key(ed, "Escape");
    if (box() || v.style.display === "none" || r.value !== was) out.openBad.push(r.id + ": Esc did not put it back");
  });

  // typing
  var S = document.getElementById("brushSize"), V = document.getElementById("brushSizeVal"), ev = [];
  S.addEventListener("input", function(){ ev.push("input"); });
  S.addEventListener("change", function(){ ev.push("change"); });
  var ed = open(V); ed.value = "120"; key(ed, "Enter");
  out.typed = { value: S.value, shown: V.textContent, ev: ev.join(","), size: App.brush.size, gone: !box() };
  ev.length = 0; ed = open(V); ed.value = "9999"; key(ed, "Enter"); out.clamp = S.value;
  ev.length = 0; ed = open(V); ed.value = "abc"; key(ed, "Enter"); out.junk = { value: S.value, ev: ev.length };
  ev.length = 0; ed = open(V); ed.value = "7"; key(ed, "Escape"); out.esc = { value: S.value, ev: ev.length };
  ed = open(document.getElementById("optLightVal")); ed.value = "1,5"; key(ed, "Enter");
  out.scaled = { raw: document.getElementById("optLight").value, shown: document.getElementById("optLightVal").textContent };
  ed = open(V); ed.value = "64"; ed.dispatchEvent(new FocusEvent("blur"));
  out.away = { value: S.value, gone: !box() };

  // the keyboard way in
  S.focus(); key(S, "Enter"); ed = box();
  out.enterOpens = !!ed && ed.previousElementSibling === V;
  key(S, "Enter");
  if (box()) key(box(), "Escape");
  out.enterTwice = { boxes: document.querySelectorAll("input.valedit").length, shown: V.style.display !== "none" };

  // a slider a panel builds after load
  var row = document.createElement("div"); row.className = "row";
  row.innerHTML = '<label>Late</label><input type="range" min="0" max="1" step="0.01" value="0.25" data-k="100"><span class="val">25%</span>';
  document.body.appendChild(row);
  var lr = row.querySelector("input"), lv = row.querySelector(".val");
  lr.oninput = function(){ lv.textContent = Math.round(lr.value * 100) + "%"; };
  ed = open(lv); var inBox = ed && ed.value; if (ed) { ed.value = "40"; key(ed, "Enter"); }
  out.late = { box: inBox, raw: lr.value, shown: lv.textContent };
  row.remove();

  // the rendered side of the font floor: every stylesheet rule and inline style in the page
  out.smallCss = [];
  var walk = function(rules){ Array.from(rules).forEach(function(ru){
    if (ru.cssRules) walk(ru.cssRules);
    if (ru.style && /px$/.test(ru.style.fontSize) && parseFloat(ru.style.fontSize) < 11) out.smallCss.push(ru.selectorText + " " + ru.style.fontSize);
  }); };
  Array.from(document.styleSheets).forEach(function(s){ walk(s.cssRules); });
  document.querySelectorAll("[style*=font-size]").forEach(function(e){ if (parseFloat(e.style.fontSize) < 11) out.smallCss.push((e.id || e.tagName) + " " + e.style.fontSize); });
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY, 800), timeoutMs: 60000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAIL: " + run.reason); process.exit(1); }
const r = run.result;
if (r.__threw) { console.log("FAIL: the page threw\n" + r.__threw); process.exit(1); }

R.is(r.bare.length === 0, r.bare.length ? "sliders that show no value: " + r.bare.join(", ") : `all ${r.total} sliders in the page show their value`);
R.is(r.spans >= 30, `${r.spans} of them are readouts the handler makes typeable`);
R.is(r.loadBad.length === 0, r.loadBad.length ? "readouts that disagree with value × data-k at load: " + r.loadBad.join(" | ") : "every numeric readout agrees with its slider × data-k at load");
R.is(r.movedBad.length === 0 && r.moved >= 15, r.movedBad.length ? "readouts that disagree after a move: " + r.movedBad.join(" | ")
  : `and again after the slider moves (${r.moved} readouts follow their slider without a model loaded)`);
R.is(r.openBad.length === 0, r.openBad.length ? "readouts that do not open cleanly: " + r.openBad.slice(0, 6).join(" | ") : `every readout opens a box showing its value, and Esc restores all ${r.spans}`);
R.is(r.typed.value === "120" && r.typed.shown === "120" && r.typed.size === 120 && r.typed.gone,
  `typing 120 sets the brush to 120 and closes the box (value ${r.typed.value}, shows ${r.typed.shown})`);
R.is(r.typed.ev === "input,change", `with exactly one input and one change — what a drag ends with ("${r.typed.ev}")`);
R.is(r.clamp === "400", `9999 clamps to the slider's max (${r.clamp})`);
R.is(r.junk.value === "400" && r.junk.ev === 0, "junk changes nothing and fires nothing");
R.is(r.esc.value === "400" && r.esc.ev === 0, "Esc changes nothing and fires nothing");
R.is(r.scaled.raw === "150" && r.scaled.shown === "1.5", `"1,5" on a readout scaled by data-k sets raw 150 and shows 1.5 (${r.scaled.raw}, ${r.scaled.shown})`);
R.is(r.away.value === "64" && r.away.gone, "a click away keeps what was typed");
R.is(r.enterOpens, "Enter on the focused slider opens its box");
R.is(r.enterTwice.boxes === 0 && r.enterTwice.shown, "a second Enter while it is open does not lose the readout");
R.is(r.late.box === "25" && r.late.raw === "0.4" && r.late.shown === "40%",
  `a slider built after load is covered with no opt-in (box ${r.late.box}, raw ${r.late.raw}, shows ${r.late.shown})`);
R.is(r.smallCss.length === 0, r.smallCss.length ? "rendered text below 11 px: " + r.smallCss.join(" | ") : "no stylesheet rule or inline style in the page sets text below 11 px");

const errs = r.__errs || [];
R.is(errs.length === 0, errs.length ? "uncaught: " + errs.join(" | ") : "no uncaught errors");
R.finish();
