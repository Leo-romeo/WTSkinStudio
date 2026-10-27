// Swatches and reference images (ROADMAP 4.50 (12)): the colours a skinner paints from.
//
// WHY THIS EXISTS. "The Market wants reference photos for a historical camouflage, and skinners work
// beside photos and colour charts. Today: there are recent colours and nothing else." What landed is
// a swatch row with libraries (recent, your own palette, published paint standards) and a floating
// reference window with an eyedropper. Nothing else in the suite reads either, so this drives the
// real panel and window in the page:
//   A. the paint-standard libraries are there, each chip is its table's colour, a click sets the
//      brush, and the row says the chips are sRGB approximations;
//   B. My palette: + keeps the brush colour, Alt+click takes it out, a settings FILE carries it and a
//      file holding junk is held to colours;
//   C. the reference window: an image added from a file, the eyedropper reads the image's own texel
//      wherever the view is zoomed, and the wheel zooms about the pointer;
//   D. a project carries the images only when Save with project is ticked, as the bytes they came
//      in, and loading it brings them back into the window.
//
// Usage: node tools/t152_swatches.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `async function(){
  var out = {};
  var chips = function(){ return Array.prototype.slice.call(document.querySelectorAll("#palette .swchip")); };
  var rgbHex = function(css){ var m = /rgb\\((\\d+), (\\d+), (\\d+)\\)/.exec(css); return m ? "#" + [m[1], m[2], m[3]].map(function(n){ return (+n).toString(16).padStart(2, "0"); }).join("") : css; };

  // ---- A. the paint standards ----
  out.libs = Swatches.libs().map(function(L){ return L.id; });
  out.sets = PAINT_STD.map(function(S){ return { id: S.id, n: S.colors.length, source: S.source,
    bad: S.colors.filter(function(c){ return !/^#[0-9a-f]{6}$/.test(c[2]) || !c[0]; }).length }; });
  Swatches.set("ral");
  var ral = PAINT_STD.find(function(S){ return S.id === "ral"; });
  var cs = chips();
  out.ral = { chips: cs.length, want: ral.colors.length, first: cs[0] && rgbHex(cs[0].style.backgroundColor), firstWant: ral.colors[0][2],
              title: cs[0] && cs[0].title, note: document.getElementById("swNote").textContent, noteShown: document.getElementById("swNote").style.display !== "none" };
  cs[3].onclick({ altKey: false });
  out.ral.picked = { brush: App.brush.color, field: document.getElementById("brushColor").value, want: ral.colors[3][2] };

  // ---- B. my own palette ----
  Swatches.set("mine"); Swatches.mine = []; Swatches.render();
  App.brush.color = "#12ab34";
  document.getElementById("btnSwAdd").onclick();
  App.brush.color = "#abcdef";
  document.getElementById("btnSwAdd").onclick();
  out.mine = { after: Swatches.mine.slice(), chips: chips().length };
  var file = prefsBlob(true);
  out.mine.inFile = file.brush && file.brush.myPalette;
  chips()[0].onclick({ altKey: true });
  out.mine.dropped = Swatches.mine.slice();
  applyPrefs({ v: PREFS_VERSION, brush: { myPalette: ["#00FF00", "not a colour", 7, "#00ff00", "#0000ff"] } });
  out.mine.adopted = Swatches.mine.slice();
  Swatches.set("recent");

  // ---- C. the reference window ----
  var im = mkCanvas(40, 20), ig = ctx2d(im);
  ig.fillStyle = "#ff0000"; ig.fillRect(0, 0, 20, 20); ig.fillStyle = "#0000ff"; ig.fillRect(20, 0, 20, 20);
  var png = await new Promise(function(res){ im.toBlob(res, "image/png"); });
  var f = new File([png], "chart.png", { type: "image/png" });
  await RefWin.addFiles([f]);
  var w = document.getElementById("winRef"), cv = document.getElementById("refCanvas");
  out.ref = { shown: w && w.style.display !== "none", n: RefWin.imgs.length, canvas: cv && [cv.clientWidth, cv.clientHeight] };
  var at = function(tx, ty){ var v = RefWin.view; return [v.x + (tx + .5) * v.k, v.y + (ty + .5) * v.k]; };
  var p = at(5, 5); RefWin.pick(p[0], p[1]); out.ref.left = App.brush.color;
  p = at(30, 10); RefWin.pick(p[0], p[1]); out.ref.right = App.brush.color;
  // zoomed in four times about the right-hand texel: the same texel stays under the pointer
  var b = cv.getBoundingClientRect(), kWas = RefWin.view.k;
  for (var i = 0; i < 8; i++) cv.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: b.left + p[0], clientY: b.top + p[1], bubbles: true, cancelable: true }));
  out.ref.zoom = RefWin.view.k / kWas;
  out.ref.still = RefWin.texel(p[0], p[1]);
  var q = at(2, 2); RefWin.pick(q[0], q[1]); out.ref.zoomedLeft = App.brush.color;
  out.ref.off = RefWin.pick(RefWin.view.x - 10, RefWin.view.y - 10);    // above and left of the image
  // review of 4.50 (12): the bytes are held, not the File; a right press picks nothing; a double-click
  // that fits puts the brush back; a drop on the window takes the page's drop overlay down
  out.ref.copied = !(RefWin.imgs[0].blob instanceof File) && RefWin.imgs[0].blob.size === f.size;
  App.brush.color = "#123456";
  cv.dispatchEvent(new PointerEvent("pointerdown", { button: 2, clientX: b.left + p[0], clientY: b.top + p[1], bubbles: true }));
  cv.dispatchEvent(new PointerEvent("pointerup", { button: 2, clientX: b.left + p[0], clientY: b.top + p[1], bubbles: true }));
  out.ref.rightKept = App.brush.color;
  RefWin.picked = { at: performance.now(), was: "#123456" }; App.brush.color = "#ff0000";
  cv.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  out.ref.dblBack = App.brush.color;
  var dt = new DataTransfer(); dt.items.add(new File([png], "chart2.png", { type: "image/png" }));
  window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
  var shownOver = document.getElementById("drop").style.display;
  w.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  await new Promise(function(res){ setTimeout(res, 300); });
  out.ref.drop = { over: shownOver, after: document.getElementById("drop").style.display, n: RefWin.imgs.length };

  // ---- D. in the project only when asked ----
  RefWin.remove(1);                                       // the dropped one: D is about the first
  var m1 = {}, f1 = [];
  RefWin.keep = false; RefWin.save(m1, f1);
  out.proj = { offRefs: m1.refs === undefined, offFiles: f1.length };
  var m2 = { app: "wt-skin-studio", version: PROJ_VERSION, slots: [] }, f2 = [];
  RefWin.keep = true; RefWin.save(m2, f2);
  out.proj.onRefs = m2.refs; out.proj.sameBytes = f2.length === 1 && f2[0][1] === RefWin.imgs[0].blob && f2[0][1].size === f.size;
  var z = new JSZip();
  for (var k = 0; k < f2.length; k++) z.file(f2[k][0], f2[k][1]);
  z.file("project.json", JSON.stringify(m2));
  RefWin.remove(0); RefWin.keep = false; RefWin.close();
  out.proj.cleared = RefWin.imgs.length;
  await loadProject(await z.generateAsync({ type: "uint8array" }));
  out.proj.back = { n: RefWin.imgs.length, name: RefWin.imgs[0] && RefWin.imgs[0].name, keep: RefWin.keep,
                    box: document.getElementById("refKeep").checked, open: document.getElementById("winRef").style.display !== "none",
                    size: RefWin.imgs[0] && [RefWin.imgs[0].bmp.width, RefWin.imgs[0].bmp.height] };
  // …and a project saved WITHOUT them unticks the box, so its next save does not carry the last one's photos
  var z2 = new JSZip(); z2.file("project.json", JSON.stringify({ app: "wt-skin-studio", version: PROJ_VERSION, slots: [] }));
  await loadProject(await z2.generateAsync({ type: "uint8array" }));
  var m3 = {}, f3 = []; RefWin.save(m3, f3);
  out.proj.next = { keep: RefWin.keep, box: document.getElementById("refKeep").checked, refs: m3.refs === undefined };
  return out;
}`;

const run = await evalInPage({ browser, expr: pageExpr(BODY), timeoutMs: 120000, keep: argv.includes("--keep") });
if (!run.ok) { console.log("FAILED to evaluate: " + JSON.stringify(run)); process.exit(1); }
const r = run.result, J = JSON.stringify;
if (r.__threw) { console.log("threw in page:\n" + r.__threw); process.exit(1); }

console.log("\n=== A. paint standards ===");
console.log(`   libraries ${J(r.libs)} · sets ${J(r.sets)}`);
R.is(["recent", "mine", "fs595", "ana", "ral"].every(id => r.libs.includes(id)) && r.sets.every(s => s.n >= 20 && s.bad === 0 && s.source),
  `the swatch row offers recent colours, your own palette and three cited paint standards, every chip a code and a #rrggbb (${r.sets.map(s => s.id + " " + s.n).join(", ")})`);
R.is(r.ral.chips === r.ral.want && r.ral.first === r.ral.firstWant && /RAL 1001/.test(r.ral.title) && /sRGB approximation/.test(r.ral.title),
  `RAL shows its ${r.ral.want} chips in its table's colours (${r.ral.first}), each named with the sample it approximates: "${r.ral.title}"`);
R.is(r.ral.noteShown && /sRGB approximations/.test(r.ral.note), `and the row says plainly that a chip is an sRGB approximation of a paint sample: "${r.ral.note}"`);
R.is(r.ral.picked.brush === r.ral.picked.want && r.ral.picked.field === r.ral.picked.want, `a chip click is the brush's colour (${J(r.ral.picked)})`);

console.log("\n=== B. my palette ===");
console.log(`   ${J(r.mine)}`);
R.is(J(r.mine.after) === J(["#12ab34", "#abcdef"]) && r.mine.chips === 2, `+ keeps the brush's colour, in order (${J(r.mine.after)})`);
R.is(J(r.mine.inFile) === J(["#12ab34", "#abcdef"]), `a settings file carries it (${J(r.mine.inFile)})`);
R.is(J(r.mine.dropped) === J(["#abcdef"]), `Alt+click takes a chip out (${J(r.mine.dropped)})`);
R.is(J(r.mine.adopted) === J(["#00ff00", "#0000ff"]), `and a file is held to colours: junk dropped, case folded, repeats once (${J(r.mine.adopted)})`);

console.log("\n=== C. the reference window ===");
console.log(`   ${J(r.ref)}`);
R.is(r.ref.shown && r.ref.n === 1 && r.ref.canvas && r.ref.canvas[0] > 100, `an image from a file opens in the window (${J(r.ref.canvas)})`);
R.is(r.ref.left === "#ff0000" && r.ref.right === "#0000ff", `a click takes the colour of the image texel under it (${r.ref.left}, ${r.ref.right})`);
R.is(r.ref.zoom > 4 && r.ref.still && r.ref.still.x === 30 && r.ref.still.y === 10 && r.ref.zoomedLeft === "#ff0000",
  `the wheel zooms about the pointer (×${r.ref.zoom && r.ref.zoom.toFixed(1)}, the texel under it still ${J(r.ref.still)}) and a pick zoomed in reads the same image`);
R.is(r.ref.off === null, "a click off the image picks nothing");
R.is(r.ref.copied, "the window holds the image's bytes, not the file on disk — a photo edited or deleted after it was added cannot break a save or a recovery copy");
R.is(r.ref.rightKept === "#123456", `a right press picks nothing (${r.ref.rightKept})`);
R.is(r.ref.dblBack === "#123456", `a double-click fits the view and puts back the colour its two clicks picked (${r.ref.dblBack})`);
R.is(r.ref.drop && r.ref.drop.over === "flex" && r.ref.drop.after === "none" && r.ref.drop.n === 2,
  `a drop on the window is a reference (${r.ref.drop && r.ref.drop.n} images) and takes the page's drop overlay down (${J(r.ref.drop)})`);

console.log("\n=== D. the project ===");
console.log(`   ${J(r.proj)}`);
R.is(r.proj.offRefs && r.proj.offFiles === 0, "with Save with project off (the default) a project carries no reference image at all — they are often someone else's photos");
R.is(Array.isArray(r.proj.onRefs) && r.proj.onRefs.length === 1 && r.proj.onRefs[0].file === "refs/r0.png" && r.proj.sameBytes,
  `ticked, it carries each as the bytes it came in, not a re-encode (${J(r.proj.onRefs)})`);
R.is(r.proj.cleared === 0 && r.proj.back.n === 1 && r.proj.back.name === "chart.png" && r.proj.back.keep && r.proj.back.box && r.proj.back.open && J(r.proj.back.size) === J([40, 20]),
  `and loading it brings them back into the window, Save with project ticked as it was saved (${J(r.proj.back)})`);
R.is(r.proj.next && !r.proj.next.keep && !r.proj.next.box && r.proj.next.refs,
  `a project saved without them unticks the box, so its next save carries none of the last one's photos (${J(r.proj.next)})`);

const errs = (r.__errs || []).filter(e => !/net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
