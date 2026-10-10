// The undo history is budgeted in BYTES, the ceiling is a setting, and it says so (ROADMAP 1.5).
//
// WHY THIS EXISTS. The roadmap carried "the stack is still step-counted" for months after it had
// stopped being true, and nothing in the suite looked at the history's size at all — so the claim
// could not be checked and the behaviour could not regress noisily. What is asserted are the ways
// the history can go wrong without anything appearing broken:
//
//   * **Eviction is oldest-first and stays under the ceiling.** 40 steps of 4K tiles is gigabytes,
//     so a stack that does not evict is a tab that dies after an hour — and one that evicts from
//     the wrong end takes the stroke you just made.
//   * **At least one entry always survives.** A single step larger than the whole budget is still
//     better than no undo at all, and the loop's `length > 1` is the only thing saying so.
//   * **A budget that is not one of the options must not become ZERO.** Assigning an unknown value
//     to a <select> leaves it on nothing, `+"" * 1048576` is 0, and a budget of 0 throws the entire
//     history away on the next push. That is one corrupt prefs file away from being real.
//
// And the visible half: eviction used to be completely invisible — "my undo only goes back four
// steps" had no explanation anywhere in the UI — so the Settings hint and the undo button's own
// tooltip are checked to actually carry the numbers.
//
// Usage: node tools/t56_undo.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();

const BODY = `function(){
  var out = {}, MB = 1048576;
  var nop = function(){};
  // Synthetic entries: "bytes" is a number the stack is told, so the budget can be exercised at
  // gigabyte scale without allocating a gigabyte.
  var push = function(name, mb){ pushAction(name, nop, nop, mb * MB); };
  var names = function(){ return App.undoStack.map(function(a){ return a.desc; }); };
  App.undoStack.length = 0;

  // ---- oldest first, and never over the ceiling ----
  setUndoBudget(384);
  out.budget = App.undoBudget / MB;
  for (var i = 1; i <= 10; i++) push("s" + i, 50);          // 500 MB of 50 MB steps into 384
  out.evicted = { kept: names(), mb: Math.round(undoBytes() / MB) };

  // ---- one entry always survives, however big ----
  App.undoStack.length = 0;
  push("huge", 900);
  out.huge = { kept: names(), mb: Math.round(undoBytes() / MB) };
  push("after", 10);                                        // the huge one goes, the new one stays
  out.afterHuge = names();

  // ---- lowering the ceiling trims NOW, not on the next push ----
  App.undoStack.length = 0;
  setUndoBudget(768);
  for (var j = 1; j <= 6; j++) push("t" + j, 100);          // 600 MB, all of it fits
  out.roomy = { kept: names().length, mb: Math.round(undoBytes() / MB) };
  setUndoBudget(256);
  out.lowered = { kept: names(), mb: Math.round(undoBytes() / MB), budget: App.undoBudget / MB };

  // ---- a value that is not an option must not become a budget of zero ----
  setUndoBudget(999);
  out.bogus = { budget: App.undoBudget / MB, sel: $("optUndoBudget").value };
  App.undoStack.length = 0;
  push("survivor", 1);
  out.bogusKept = names();

  // ---- the step cap still applies to steps too small to reach the byte ceiling ----
  setUndoBudget(3072);
  App.undoStack.length = 0;
  for (var k = 0; k < 300; k++) push("tiny" + k, 0);
  out.capped = { kept: App.undoStack.length, first: App.undoStack[0].desc };

  // ---- and it says so, where somebody wondering would look ----
  setUndoBudget(384);
  App.undoStack.length = 0;
  refreshUndoUsage();
  out.empty = { hint: $("undoUsage").textContent, title: $("btnUndo").title };
  push("a", 12); push("b", 8);
  out.filled = { hint: $("undoUsage").textContent, title: $("btnUndo").title };

  // ---- the full-history message is said once per fill, not once per stroke ----
  App.undoStack.length = 0;
  setUndoBudget(128);
  var said = 0, statusWas = setStatus;
  setStatus = function(m, c){ if (/Undo history is full/.test(m)) said++; return statusWas(m, c); };
  for (var q = 0; q < 12; q++) push("f" + q, 40);           // full after four, evicting for eight
  out.saidOnce = said;
  setStatus = statusWas;

  // ---- and the thing that actually FEEDS the budget reports a real number ----
  // Everything above is synthetic on purpose — that is what lets a gigabyte be exercised without
  // allocating one — but it means the whole file proves the stack SPENDS the number it is told and
  // nothing proves the number is real. makeTileUndo is the producer, and its own comment says
  // these snapshots are the heaviest thing the history holds: if that number were nominal, the
  // budget would be blind to exactly the entries it exists to evict. So one real recorder is driven
  // here, on a sheet whose tile arithmetic is known.
  App.undoStack.length = 0;
  setUndoBudget(384);
  var tc = mkCanvas(TILE * 3, TILE * 2);                    // 3 x 2 tiles exactly
  var tg = ctx2d(tc);
  tg.fillStyle = "#0000ff"; tg.fillRect(0, 0, tc.width, tc.height);
  var lastBox = null;
  var u = makeTileUndo(tc, "tile probe", function(R2){ lastBox = R2; });
  // A stamp of radius 4 wholly inside tile (0,0). floor((x±r)/TILE) is one tile; ceil would take
  // the neighbours too, which is the bug the code's own comment records — an extra row and column
  // snapshotted on every single stamp.
  u.record(TILE / 2, TILE / 2, 4);
  out.tiles = { insideOne: u.dirty.size };
  // A stamp straddling the boundary between (0,0) and (1,0) must take exactly those two.
  u.record(TILE, TILE / 2, 4);
  out.tiles.straddle = u.dirty.size;
  // Off the right-hand edge: clamped to the sheet, never a fourth column that does not exist.
  u.record(tc.width + 50, TILE / 2, 4);
  out.tiles.pastEdge = u.dirty.size;
  out.tiles.bbox = u.bbox();
  // Paint something, commit, and see what the stack was told it costs.
  tg.fillStyle = "#ff0000"; tg.fillRect(0, 0, TILE * 2, TILE);
  u.commit();
  var entry = App.undoStack[App.undoStack.length - 1];
  out.tiles.bytes = entry ? entry.bytes : 0;
  out.tiles.tilesTouched = out.tiles.pastEdge;
  out.tiles.perTile = TILE * TILE * 4;
  out.tiles.TILE = TILE;
  // and it really is a working undo, not just a number
  out.tiles.painted = ctx2d(tc).getImageData(4, 4, 1, 1).data[0];
  entry.undo();
  out.tiles.undone = ctx2d(tc).getImageData(4, 4, 1, 1).data[0];
  out.tiles.undoBox = lastBox;

  App.undoStack.length = 0;
  setUndoBudget(384);
  refreshUndoUsage();
  return out;
}`;

const r = await evalInPage({ browser, expr: pageExpr(BODY, 400), keep: argv.includes("--keep") });
if (!r.ok) { console.log("FAILED to evaluate: " + JSON.stringify(r).slice(0, 400)); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("threw in page:\n" + o.__threw); process.exit(1); }

console.log("=== the ceiling is in bytes, and it holds ===");
console.log(`   ten 50 MB steps into ${o.budget} MB → kept ${o.evicted.kept.join(", ")} (${o.evicted.mb} MB)`);
R.is(o.evicted.mb <= o.budget, `the history stays under the ceiling (${o.evicted.mb} of ${o.budget} MB)`);
R.is(o.evicted.kept[o.evicted.kept.length - 1] === "s10",
  "the newest step is kept — evicting the wrong end would lose the stroke you just made");
R.is(o.evicted.kept[0] === "s4" && o.evicted.kept.length === 7,
  `and the oldest go first (kept ${o.evicted.kept.length}, from ${o.evicted.kept[0]})`);

console.log("\n=== one step is always kept, however big ===");
R.is(o.huge.kept.length === 1 && o.huge.mb === 900,
  `a 900 MB step into a 384 MB budget survives alone (${o.huge.mb} MB) — one giant undo beats none`);
R.is(o.afterHuge.length === 1 && o.afterHuge[0] === "after",
  `and gives way as soon as there is something else to keep (${o.afterHuge.join(", ")})`);

console.log("\n=== lowering the ceiling trims immediately ===");
console.log(`   768 MB: ${o.roomy.kept} steps, ${o.roomy.mb} MB   →   256 MB: ${o.lowered.kept.length} steps, ${o.lowered.mb} MB`);
R.is(o.roomy.kept === 6 && o.roomy.mb === 600, `600 MB of steps all fit under 768 (${o.roomy.kept} steps)`);
R.is(o.lowered.mb <= 256 && o.lowered.kept.length === 2,
  `and lowering it to 256 trims there and then rather than on the next push (${o.lowered.mb} MB)`);
R.is(o.lowered.kept[o.lowered.kept.length - 1] === "t6", "still from the oldest end");

console.log("\n=== a budget that is not an option is not a budget of zero ===");
R.is(o.bogus.budget === 384 && o.bogus.sel === "384",
  `999 falls back to the option the markup ships (${o.bogus.budget} MB, the select reads "${o.bogus.sel}")`);
R.is(o.bogusKept.length === 1, "so the next push does not wipe the history — which is what a budget of 0 would do");

console.log("\n=== the step cap still catches steps too cheap to hit the byte ceiling ===");
R.is(o.capped.kept === 250 && o.capped.first === "tiny50",
  `300 zero-cost steps are capped at ${o.capped.kept}, oldest dropped (${o.capped.first} is now first)`);

console.log("\n=== and it says what it is holding ===");
console.log(`   empty:  ${o.empty.hint}`);
console.log(`   filled: ${o.filled.hint}`);
console.log(`   button: ${o.filled.title}`);
R.is(/384 MB/.test(o.empty.hint), "with nothing held it still states the limit — that is the number the user came to find");
R.is(/2 steps/.test(o.filled.hint) && /20 MB of 384 MB/.test(o.filled.hint),
  "and with history it states steps, usage and limit");
R.is(/Ctrl\+Z/.test(o.filled.title) && /20 MB of 384 MB/.test(o.filled.title),
  "the undo button carries it too, which is where somebody wondering why undo stopped is already pointing");
R.is(/nothing to undo/.test(o.empty.title), "and says so plainly when there is nothing to undo");

console.log("\n=== the full-history warning is once per fill ===");
R.is(o.saidOnce === 1, `eight evictions in a row said it ${o.saidOnce} time — once the history is full every stroke evicts`);

console.log("\n=== the producer reports a real number, not a nominal one ===");
const T = o.tiles;
console.log(`   tiles ${T.insideOne} → ${T.straddle} → ${T.pastEdge}, bbox ${JSON.stringify(T.bbox)}, ${T.bytes} bytes`);
R.is(T.insideOne === 1,
  `a stamp wholly inside one tile takes one tile (${T.insideOne}) — the bounds floor rather than ceil, and rounding up snapshotted an extra row AND column on every single stamp`);
R.is(T.straddle === 2, `one straddling a boundary takes exactly the two it covers (${T.straddle})`);
R.is(T.pastEdge === 2,
  `and one off the sheet entirely adds none (${T.pastEdge}) — clamped to the tiles that exist, not to a column past the edge`);
R.is(!!T.bbox && T.bbox.x === 0 && T.bbox.y === 0 && T.bbox.w === 2 * T.TILE && T.bbox.h === T.TILE,
  `bbox is the union of exactly those two tiles (${JSON.stringify(T.bbox)}) — it is what keeps the composite after an undo local instead of whole-sheet, so a bbox that quietly grew to the sheet would be invisible except as a slow undo`);
R.is(T.bytes === T.tilesTouched * T.perTile * 2,
  `commit costs the before AND after pixels of every touched tile (${T.bytes} = ${T.tilesTouched} × ${T.perTile} × 2) — a nominal number here would leave the budget blind to the heaviest thing the history holds, which is what every entry above is spending`);
R.is(T.painted === 255 && T.undone === 0,
  `and it is a working undo, not just a cost (${T.painted} → ${T.undone}) — the number and the pixels come from the same tiles`);
R.is(!!T.undoBox, `the undo hands back the rectangle it changed, so what follows it stays local`);

const errs = (o.__errs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
