// How tools/all.mjs runs the suite in parallel lanes (ROADMAP 0.4). Kept apart from all.mjs, which is
// a script that exits, so that tools/t143_lanes.mjs can drive the scheduler, the in-order report and
// the deadline's tree kill with tests of its own and see each one fail.
//
// Measured 2026-10-22 on the owner's machine (Ryzen 5 3600, 6 cores / 12 threads): one test at a
// time, `npm test` was 307 s, almost all of it a long tail of browser tests that each sit mostly
// idle waiting on their own headless Chrome. Every one of those launches already gets its own
// mkdtemp profile and `--remote-debugging-port=0` (tools/headless.mjs), so two never collide.
import os from "os";
import { spawn, execFileSync } from "child_process";

// Half the logical CPUs, capped at 6: each lane is one Node plus, for most tests, one Chrome with its
// own renderer, GPU and utility processes, so a lane per logical CPU starves the very tests whose
// assertions read time. `--jobs` and WT_TEST_JOBS override it; `--jobs 1` is the old run, test by
// test in the suite's order — the one to use while the machine is wanted for something else.
export function defaultJobs() {
  const n = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(6, Math.floor(n / 2)));
}

// The suite runs below normal priority, and so does everything it starts. The owner, 2026-10-24:
// "make tests leave a bit of headroom for me to match video without a lag". Until then every run was
// wrapped by hand in a PowerShell line that lowered its own process, and an agent that forgot the
// wrapper took the machine at full priority; this makes `npm test` the wrapper. Windows gives a child
// its parent's class when the parent is below normal (CreateProcess, with no class flag), so node
// and every Chrome inherit it — t167_guards spawns a child each way and reads its priority back.
// WT_TEST_PRIORITY=normal opts out, for a timing measurement that needs the machine.
export function yieldToOwner(env = process.env) {
  if (env.WT_TEST_PRIORITY === "normal") return false;
  os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL);
  return true;
}

// Kill a process and everything it started. `child.kill()` on Windows ends the one process and leaves
// its children: a test killed that way leaves its Chrome running, and every Chrome it spawned.
// `taskkill /T` walks the tree; elsewhere the test is started as its own process group (`detached`)
// and the group is signalled.
export function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    try { execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
    catch { /* taskkill exits non-zero when the tree is already gone — which is the outcome wanted */ }
  } else {
    try { process.kill(-pid, "SIGKILL"); }
    catch { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
  }
}

const live = new Set();          // every test running now, so an interrupted run leaves no tree behind
let trapped = false;
function trapInterrupt() {
  if (trapped) return;
  trapped = true;
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { for (const pid of live) killTree(pid); process.exit(130); });
}

// Run one command to completion or to its deadline. Resolves { code, out, ms, timedOut }; a test past
// its deadline has its whole tree killed and comes back with timedOut set and code null.
export function runProcess(cmd, args, { cwd, env, deadlineMs = 0, onData } = {}) {
  trapInterrupt();
  return new Promise(resolve => {
    const started = Date.now();
    const p = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32", windowsHide: true });
    let out = "", timedOut = false, settled = false;
    if (p.pid) live.add(p.pid);
    const take = d => { out += d; if (onData) onData(d); };
    p.stdout.on("data", take);
    p.stderr.on("data", take);
    const timer = deadlineMs > 0 ? setTimeout(() => { timedOut = true; killTree(p.pid); }, deadlineMs) : null;
    const finish = r => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      live.delete(p.pid);
      resolve({ ...r, out, ms: Date.now() - started, timedOut });
    };
    p.on("error", e => { out += String(e.message); finish({ code: -1 }); });
    p.on("close", code => finish({ code: timedOut ? null : code }));
  });
}

// Run `tests` in `jobs` lanes. Each test may be `serial` (it asserts wall-clock time, so it runs after
// the parallel phase with nothing else running). `times` maps an id to its last duration in ms; the
// parallel phase starts the longest first, so the slowest test is not the last one to begin, and an
// id with no time yet counts as longest, so a new test cannot become the tail. `run(test)` returns a
// promise of its result; `onDone(index, result)` is called as each finishes, with the test's index in
// `tests`. Resolves the results in `tests`' own order. At jobs = 1 everything runs in suite order,
// serial or not — that is the run as it was before lanes.
export async function schedule(tests, { jobs, times = {}, run, onStart = () => {}, onDone = () => {} }) {
  const results = new Array(tests.length);
  const idx = tests.map((t, i) => i);
  const go = async i => { onStart(i); results[i] = await run(tests[i]); onDone(i, results[i]); };
  if (jobs <= 1) {
    for (const i of idx) await go(i);
    return results;
  }
  const cost = i => times[tests[i].id] ?? Infinity;
  const queue = idx.filter(i => !tests[i].serial).sort((a, b) => cost(b) - cost(a) || a - b);
  const lane = async () => { while (queue.length) await go(queue.shift()); };
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, lane));
  for (const i of idx.filter(i => tests[i].serial)) await go(i);
  return results;
}

// Print results in the suite's order however they finish: a line goes out as soon as every test
// before it has gone out, so the report reads the same as a run at --jobs 1.
export function inOrder(n, print) {
  const ready = new Array(n);
  let next = 0;
  return (i, value) => {
    ready[i] = { value };
    while (next < n && ready[next]) { print(next, ready[next].value); next++; }
  };
}
