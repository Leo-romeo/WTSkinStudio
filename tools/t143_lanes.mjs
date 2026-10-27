// The suite's parallel lanes (ROADMAP 0.4): tools/lanes.mjs, which tools/all.mjs runs every test
// through. Three things have to hold and none of them shows in a green run:
//   * the scheduler keeps to its lanes — never more at once than asked, the longest test first, the
//     `serial` ones after the parallel phase and alone, and --jobs 1 the old run in suite order;
//   * the report is in the suite's order however the tests finish;
//   * a test past its deadline is killed with everything it started — a hung browser test otherwise
//     leaves its Chrome behind on Windows, where killing a process does not kill its children.
// The last is checked against a CONTROL: the same hanging test stopped with a plain `kill()` must
// leave its children running, or the check could not see a leak and would prove nothing.
//
// Usage: node tools/t143_lanes.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { makeReport, findBrowser } from "./headless.mjs";
import { schedule, inOrder, runProcess, killTree, defaultJobs } from "./lanes.mjs";

const R = makeReport();
const J = v => JSON.stringify(v);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const started = Date.now();

// ------------------------------------------------------------------------------- the scheduler
console.log("=== lanes: how many at once, in what order, serial ones alone ===");
const fake = [
  { id: "a", ms: 120 },
  { id: "b", ms: 300 },
  { id: "c", ms: 40, serial: true },
  { id: "d", ms: 200 },                 // no recorded time: counts as longest
  { id: "e", ms: 30 },
  { id: "f", ms: 40, serial: true },
];
const times = { a: 120, b: 300, c: 40, e: 30, f: 40 };
async function drive(jobs) {
  let now = 0, peak = 0;
  const starts = [], ends = [], during = {}, printed = [];
  const print = inOrder(fake.length, i => printed.push(fake[i].id));
  const res = await schedule(fake, { jobs, times,
    onStart: i => { starts.push(fake[i].id); now++; peak = Math.max(peak, now); during[fake[i].id] = now; },
    run: async t => { await sleep(t.ms); return "r:" + t.id; },
    onDone: (i, r) => { now--; ends.push(fake[i].id); print(i, r); } });
  return { res, peak, starts, ends, during, printed };
}
const two = await drive(2);
R.is(two.peak === 2, `--jobs 2 runs two at once and never more → peak ${two.peak}`);
R.is(J(two.starts.slice(0, 4)) === J(["d", "b", "a", "e"]),
  `the parallel phase starts the longest first, an unmeasured test before any measured one → ${J(two.starts)}`);
R.is(J(two.starts.slice(4)) === J(["c", "f"]) && two.during.c === 1 && two.during.f === 1,
  `the serial tests run after it, in suite order, each with nothing else running → ${J(two.starts.slice(4))}, ${J({ c: two.during.c, f: two.during.f })}`);
R.is(J(two.res) === J(fake.map(t => "r:" + t.id)), `the results come back in the suite's order → ${J(two.res)}`);
R.is(J(two.ends) !== J(fake.map(t => t.id)),
  `control: they did not FINISH in the suite's order, so the report below is a real reordering → ${J(two.ends)}`);
R.is(J(two.printed) === J(fake.map(t => t.id)), `and the report prints them in the suite's order → ${J(two.printed)}`);
const one = await drive(1);
R.is(one.peak === 1 && J(one.starts) === J(fake.map(t => t.id)),
  `--jobs 1 is the old run: one at a time, in suite order, serial ones where they stand → peak ${one.peak}, ${J(one.starts)}`);
const dj = defaultJobs();
R.is(dj >= 1 && dj <= 6, `the default lane count is half the logical CPUs, 1 to 6 → ${dj} on this machine`);

// ------------------------------------------------------------------- the deadline and the tree
console.log("\n=== a test past its deadline is killed with everything it started ===");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t143-lanes-"));
const browser = findBrowser();
// A test that hangs on purpose: it starts two Nodes that never exit and, where there is one, a headless
// browser, writes their pids down, and then waits forever. MEASURED 2026-10-22: on Windows, killing a
// Node alone does take down the children it spawned plainly — libuv puts them in a job object that
// kills them when the parent's handle closes — so the first version of this control saw no leak at
// all. What escapes is a process that left that job: one spawned `detached`, or the sandboxed
// processes Chrome starts with breakaway. The second Node stands for those; on Windows it is
// detached, elsewhere (where a plain kill leaves every child running) it is a plain child, because a
// detached one there would be its own process group and outside any test's tree by design.
const hang = path.join(dir, "hang.mjs");
fs.writeFileSync(hang, `
import { spawn } from "child_process";
import fs from "fs";
const [pidFile, browser, profile] = process.argv.slice(2);
const forever = ["-e", "setInterval(() => {}, 1000)"];
const kids = [spawn(process.execPath, forever, { stdio: "ignore" }),
  spawn(process.execPath, forever, { stdio: "ignore", detached: process.platform === "win32" })];
if (browser) kids.push(spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" }));
fs.writeFileSync(pidFile, JSON.stringify(kids.map(k => k.pid)));
console.log("hanging with " + kids.length + " children");
setInterval(() => {}, 1000);
`);
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function pidsOf(file) {
  for (let i = 0; i < 200 && !fs.existsSync(file); i++) await sleep(50);
  await sleep(300);     // the file is written whole in one call, but give the browser a moment to be up
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
async function settleDead(pids) {
  for (let i = 0; i < 60 && pids.some(alive); i++) await sleep(100);
  return pids.filter(alive);
}
const args = n => [hang, path.join(dir, `pids${n}.json`), browser || "", path.join(dir, "profile" + n)];

// The control first: a plain kill of the test's own process.
{
  const p = spawn(process.execPath, args(0), { stdio: "ignore" });
  const kids = await pidsOf(path.join(dir, "pids0.json"));
  p.kill();
  await new Promise(r => p.once("exit", r));
  await sleep(500);
  const left = kids.filter(alive);
  R.is(left.length >= 1,
    `control: a plain kill() of a hung test leaves some of its ${kids.length} children running (two Nodes${browser ? " and a browser" : "; no browser on this machine"}) → ${left.length} still alive`);
  for (const pid of kids) killTree(pid);
  await settleDead(kids);
}

const r = await runProcess(process.execPath, args(1), { deadlineMs: 3000 });
const kids = JSON.parse(fs.readFileSync(path.join(dir, "pids1.json"), "utf8"));
R.is(r.timedOut && r.code === null && r.ms >= 2900 && r.ms < 20000,
  `a test that hangs is stopped at its 3 s deadline and reported as timed out → timedOut ${r.timedOut}, code ${r.code}, ${(r.ms / 1000).toFixed(1)} s`);
R.is(/hanging with \d children/.test(r.out), `and what it printed is kept, for the report's tail → ${J(r.out.trim())}`);
const left = await settleDead(kids);
R.is(left.length === 0, `and nothing it started is left running — ${kids.length} children, ${left.length} alive${left.length ? " (pids " + left.join(", ") + ")" : ""}`);
for (const pid of left) killTree(pid);

const quick = await runProcess(process.execPath, ["-e", "console.log('done')"], { deadlineMs: 10000 });
R.is(!quick.timedOut && quick.code === 0 && quick.out.trim() === "done",
  `a test that finishes inside its deadline is untouched → code ${quick.code}, ${J(quick.out.trim())}`);

for (let i = 0; ; i++) {
  try { fs.rmSync(dir, { recursive: true, force: true }); break; }
  catch (e) { if (i >= 30) { console.log(`  (could not remove ${dir}: ${e.code || e.message})`); break; } await sleep(100); }
}
R.finish(`(${((Date.now() - started) / 1000).toFixed(1)} s)`);
