// The tests find the War Thunder install themselves, and can never pass green with a wrong one.
//
// WHY THIS EXISTS. Twice the dev install moved and every tool kept its own default path to the old
// one: D:\SteamLibrary was gone from 2026-09-07 while the tools pointed there until 2026-09-20, and
// on 2026-10-10 the C:\Program Files (x86)\Steam copy went while ~20 tools still named it. Both
// times `npm run test:all` printed SKIP for every roster sweep and exited 0 — a green run that had
// tested nothing. Since 2026-10-10 `tools/wtdir.mjs` is the one place that says where the install
// is (WT_DIR, else Steam's own library list, else the usual folders), and `tools/all.mjs` refuses to
// call a run passed when the install it needed was not there. This holds both without the install:
//
//   * the resolver, against Steam layouts built here in a temp folder: the game found in a second
//     library because libraryfolders.vdf lists it there (and not found when the list leaves that
//     library out — the control), a library that lists app 236390 but lacks the files refused, the
//     manifest's installdir followed (and a damaged manifest survived), a listed library preferred
//     over a leftover copy in the Steam folder, both markers required, the registry asked only when
//     the Steam folders had no answer, a WT_DIR that is set winning when valid and THROWING when not
//     — never swapped for a found one;
//   * tools/all.mjs, spawned: a wrong WT_DIR fails every mode before anything runs, --all and an
//     install id under --only fail with no install, and no output reads as passed; with a valid
//     WT_DIR, and with no install in plain --list, it does not fail (the controls); and no install
//     test passes over a folder that only carries the two markers;
//   * the standalone install tools, spawned with a wrong WT_DIR: each exits non-zero and says why.
//
// Usage: node tools/t133_wtdir.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { makeReport } from "./headless.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const R = makeReport();
const started = Date.now();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "t133-wtdir-"));
process.on("exit", () => fs.rmSync(TMP, { recursive: true, force: true }));

const mk = (p, body = "") => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
const dirOf = p => { fs.mkdirSync(p, { recursive: true }); return p; };
// The two things the resolver takes as proof of a War Thunder root.
const game = d => { mk(path.join(d, "aces.vromfs.bin"), "VRFs"); dirOf(path.join(d, "content", "base", "res")); return d; };
// libraryfolders.vdf the way Steam writes it: tabs, quoted keys, backslashes doubled.
const vdf = libs => '"libraryfolders"\n{\n' + libs.map((l, i) =>
  `\t"${i}"\n\t{\n\t\t"path"\t\t"${l.path.replace(/\\/g, "\\\\")}"\n\t\t"label"\t\t""\n\t\t"apps"\n\t\t{\n` +
  l.apps.map(a => `\t\t\t"${a}"\t\t"1000"\n`).join("") + "\t\t}\n\t}\n").join("") + "}\n";
function steam(name, libs) {
  const base = path.join(TMP, name), st = path.join(base, "Steam");
  const paths = libs.map((l, i) => i === 0 ? st : dirOf(path.join(base, "Lib" + i)));
  mk(path.join(st, "steamapps", "libraryfolders.vdf"), vdf(libs.map((l, i) => ({ path: paths[i], apps: l.apps }))));
  return { st, libs: paths, common: i => path.join(paths[i], "steamapps", "common") };
}
const J = JSON.stringify;

// ---------------------------------------------------------------------------- the resolver
console.log("=== tools/wtdir.mjs against synthetic Steam layouts ===");
let W = null;
try { W = await import("./wtdir.mjs"); }
catch (e) { R.bad("tools/wtdir.mjs loads — " + e.message); }

if (W) {
  const none = () => [];
  const find = (o = {}) => W.findInstall({ env: {}, registry: none, fallbackRoots: [], steamRoots: [], ...o });
  const threw = f => { try { f(); return null; } catch (e) { return e; } };

  // Two libraries, the game in the second, the second listed with app 236390.
  const s1 = steam("s1", [{ apps: ["228980"] }, { apps: ["236390", "431960"] }]);
  const g1 = game(path.join(s1.common(1), "War Thunder"));
  let regCalls = 0;
  const r1 = find({ steamRoots: [s1.st], registry: () => { regCalls++; return []; } });
  R.is(r1.dir === g1 && r1.how === "steam",
    `two libraries in libraryfolders.vdf, the game in the second: found there, by Steam → ${J(r1.dir)} (${r1.how}: ${r1.detail})`);
  R.is(regCalls === 0, `and the registry was not asked, because the Steam folder answered (${regCalls} calls)`);

  // Control: the same disk, with the list leaving the second library out — so the find above came
  // from reading the list, not from looking about.
  const s1b = steam("s1b", [{ apps: ["228980"] }, { apps: [] }]);
  game(path.join(s1b.common(1), "War Thunder"));
  fs.writeFileSync(path.join(s1b.st, "steamapps", "libraryfolders.vdf"), vdf([{ path: s1b.st, apps: ["228980"] }]));
  regCalls = 0;
  const r1b = find({ steamRoots: [s1b.st], registry: () => { regCalls++; return []; } });
  R.is(r1b.dir === null, `control: a library the list does not name is not searched → ${J(r1b.dir)}`);
  R.is(regCalls === 0, `and a Steam folder WITH a list is the answer: no registry call though nothing was found (${regCalls})`);

  // A library that lists 236390 but whose folder lacks the files is refused, with what it lacks.
  const s2 = steam("s2", [{ apps: [] }, { apps: ["236390"] }]);
  dirOf(path.join(s2.common(1), "War Thunder", "content", "base", "res"));
  const r2 = find({ steamRoots: [s2.st] });
  const t2 = (r2.tried || []).find(t => t.dir === path.join(s2.common(1), "War Thunder"));
  R.is(r2.dir === null, `a library listing app 236390 with no aces.vromfs.bin in its folder is refused → ${J(r2.dir)}`);
  R.is(!!t2 && t2.missing.includes("aces.vromfs.bin") && !t2.missing.some(m => /content/.test(m)) &&
    (r2.reason || "").includes(path.join(s2.common(1), "War Thunder")),
    `and the reason names that folder and exactly what it lacks → ${J(t2 && t2.missing)}; ${J(r2.reason)}`);
  // ...and the search goes on to the libraries that did not list it.
  const s2b = steam("s2b", [{ apps: [] }, { apps: ["236390"] }, { apps: [] }]);
  dirOf(path.join(s2b.common(1), "War Thunder", "content"));
  const g2b = game(path.join(s2b.common(2), "War Thunder"));
  const r2b = find({ steamRoots: [s2b.st] });
  R.is(r2b.dir === g2b, `a refused library does not end the search: the game in an unlisted third library is found → ${J(r2b.dir)}`);

  // The app manifest's installdir is the folder name when there is one.
  const s3 = steam("s3", [{ apps: [] }, { apps: ["236390"] }]);
  mk(path.join(s3.libs[1], "steamapps", "appmanifest_236390.acf"),
    '"AppState"\n{\n\t"appid"\t\t"236390"\n\t"name"\t\t"War Thunder"\n\t"installdir"\t\t"WT Custom"\n}\n');
  const g3 = game(path.join(s3.common(1), "WT Custom"));
  const r3 = find({ steamRoots: [s3.st] });
  R.is(r3.dir === g3, `appmanifest_236390.acf's installdir is followed → ${J(r3.dir)}`);

  // Steam before 2021 wrote "LibraryFolders" { "1" "D:\\Lib" } — a path per number, no apps list,
  // and the Steam folder itself left out. A damaged list is named, not taken for "no game".
  const s3b = steam("s3b", [{ apps: [] }, { apps: [] }]);
  fs.writeFileSync(path.join(s3b.st, "steamapps", "libraryfolders.vdf"),
    `"LibraryFolders"\n{\n\t"TimeNextStatsReport"\t\t"1791386152"\n\t"ContentStatsID"\t\t"-1"\n\t"1"\t\t"${s3b.libs[1].replace(/\\/g, "\\\\")}"\n}\n`);
  const g3b = game(path.join(s3b.common(1), "War Thunder"));
  const r3b = find({ steamRoots: [s3b.st] });
  R.is(r3b.dir === g3b, `the pre-2021 list format is read too → ${J(r3b.dir)}`);
  const s3c = steam("s3c", [{ apps: [] }]);
  fs.writeFileSync(path.join(s3c.st, "steamapps", "libraryfolders.vdf"), '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Ste');
  regCalls = 0;
  const r3c = find({ steamRoots: [s3c.st], registry: () => { regCalls++; return []; } });
  R.is(r3c.dir === null && /could not be read as a library list/.test(r3c.reason || "") && regCalls === 1,
    `a damaged list is said in the reason, and counts as no list (the registry is asked: ${regCalls}) → ${J(r3c.reason)}`);

  // The registry: asked when the usual Steam folders have no list, and its folder searched.
  regCalls = 0;
  const r4 = find({ steamRoots: [path.join(TMP, "no-steam-here")], registry: () => { regCalls++; return [s1.st]; } });
  R.is(r4.dir === g1 && r4.how === "steam" && regCalls === 1 && /regist/i.test(r4.detail),
    `no list in the usual Steam folders: the registry's Steam folder is read instead → ${J(r4.dir)}, ${regCalls} call(s), ${J(r4.detail)}`);

  // A library the list shows holding 236390 wins over one it does not, whatever the order: the Steam
  // folder itself is always searched first, and a leftover copy there must not beat the library Steam
  // says has the game — the dev machine's own shape (C:\Program Files (x86)\Steam, game on D:).
  const s5 = steam("s5", [{ apps: ["228980"] }, { apps: ["236390"] }]);
  game(path.join(s5.common(0), "War Thunder"));
  const g5 = game(path.join(s5.common(1), "War Thunder"));
  const r5l = find({ steamRoots: [s5.st] });
  R.is(r5l.dir === g5 && /listed with app 236390/.test(r5l.detail || ""),
    `a copy in the Steam folder the list does not tie to 236390 loses to the library it does → ${J(r5l.dir)} (${r5l.detail})`);

  // Both markers count: a folder with aces.vromfs.bin and no content/base/res is not an install,
  // whether WT_DIR names it or a library listing 236390 holds it — and what it lacks is named.
  const acesOnly = path.join(TMP, "acesonly", "War Thunder");
  mk(path.join(acesOnly, "aces.vromfs.bin"), "VRFs");
  const e5c = threw(() => find({ env: { WT_DIR: acesOnly } }));
  R.is(!!e5c && e5c.message.includes("has no " + path.join("content", "base", "res")) && !e5c.message.includes("no aces.vromfs.bin"),
    `a WT_DIR with aces.vromfs.bin and no content/base/res is refused for exactly that → ${J(e5c && e5c.message)}`);
  const s6 = steam("s6", [{ apps: [] }, { apps: ["236390"] }]);
  mk(path.join(s6.common(1), "War Thunder", "aces.vromfs.bin"), "VRFs");
  const r6 = find({ steamRoots: [s6.st] });
  const t6 = (r6.tried || []).find(t => t.dir === path.join(s6.common(1), "War Thunder"));
  R.is(r6.dir === null && !!t6 && t6.missing.length === 1 && /content/.test(t6.missing[0]),
    `and so is a listed library holding only aces.vromfs.bin → ${J(r6.dir)}, lacks ${J(t6 && t6.missing)}`);

  // A damaged appmanifest is not a reason to give up: Steam's own folder name for the game is left.
  const s7 = steam("s7", [{ apps: [] }, { apps: ["236390"] }]);
  mk(path.join(s7.libs[1], "steamapps", "appmanifest_236390.acf"), '"AppState"\n{\n\t"installdir"\t\t"WT Cus');
  const g7 = game(path.join(s7.common(1), "War Thunder"));
  let r7;
  try { r7 = find({ steamRoots: [s7.st] }); } catch (e) { r7 = { dir: null, error: e.message }; }
  R.is(r7.dir === g7, `a damaged appmanifest_236390.acf falls back to "War Thunder" → ${J(r7.dir)}${r7.error ? " (threw: " + r7.error + ")" : ""}`);

  // WT_DIR, when set and valid, wins over what Steam would find.
  const ge = game(path.join(TMP, "env", "War Thunder"));
  const r5 = find({ env: { WT_DIR: ge }, steamRoots: [s1.st] });
  R.is(r5.dir === ge && r5.how === "env", `a valid WT_DIR wins over the Steam library → ${J(r5.dir)} (${r5.how})`);

  // WT_DIR set but wrong THROWS, naming the path and what is missing — even with Steam able to find
  // a good one. A wrong explicit path is a misconfiguration, never something to quietly paper over.
  const empty = dirOf(path.join(TMP, "empty"));
  const e6 = threw(() => find({ env: { WT_DIR: empty }, steamRoots: [s1.st] }));
  R.is(!!e6 && e6 instanceof W.InstallError && e6.message.includes(empty) && e6.message.includes("aces.vromfs.bin"),
    `a WT_DIR that is not an install throws, naming it and aces.vromfs.bin, though Steam has one → ${J(e6 && e6.message)}`);
  const noAces = path.join(TMP, "noaces", "War Thunder");
  dirOf(path.join(noAces, "content", "base", "res"));
  const e7 = threw(() => find({ env: { WT_DIR: noAces } }));
  R.is(!!e7 && e7.message.includes("aces.vromfs.bin") && !/content/.test(e7.message.replace(noAces, "")),
    `a folder named War Thunder without aces.vromfs.bin is refused for exactly that → ${J(e7 && e7.message)}`);
  const e7b = threw(() => find({ env: { WT_DIR: path.join(TMP, "does-not-exist") } }));
  R.is(!!e7b && /does not exist/.test(e7b.message), `a WT_DIR that does not exist says so → ${J(e7b && e7b.message)}`);

  // The last resort: the usual folders, the Gaijin launcher's among them.
  const gf = game(path.join(TMP, "fallback", "WarThunder"));
  const r8 = find({ fallbackRoots: [path.join(TMP, "nope"), gf] });
  R.is(r8.dir === gf && r8.how === "fallback", `no Steam: the usual folders are tried, in order → ${J(r8.dir)} (${r8.how})`);

  // WT_DETECT=0 turns the search off — what all.mjs's no-install gate below is driven by.
  const r9 = find({ env: { WT_DETECT: "0" }, steamRoots: [s1.st], fallbackRoots: [gf] });
  R.is(r9.dir === null && /WT_DETECT/.test(r9.reason || ""), `WT_DETECT=0 searches nothing → ${J(r9.dir)}; ${J(r9.reason)}`);

  // Cheap enough to run at the top of every test. Bounded on the layouts above, where the cost is the
  // resolver's own work: the real search's time is printed, never bounded, because on the dev machine
  // the install is on a spinning disk (D:, a WD10EZEX) and a drive waking up took 465 ms for one
  // stat, measured 2026-10-10 — a bound there would be a test of the disk.
  const t0 = performance.now();
  for (let k = 0; k < 10; k++) find({ steamRoots: [s2b.st] });
  const each = (performance.now() - t0) / 10;
  R.is(each < 100, `a search through three libraries and a refusal takes ${each.toFixed(2)} ms (bound 100)`);

  // The real search, on this machine, with nothing injected: whatever it finds must be an install.
  const env = { ...process.env }; delete env.WT_DIR; delete env.WT_DETECT;
  const real = W.findInstall({ env });
  R.is(real.dir === null || W.installProblems(real.dir).length === 0,
    `the real search finds an install or nothing, never a non-install → ${W.describeInstall(real)}`);
}

// ---------------------------------------------------------------------------- tools/all.mjs
console.log("\n=== tools/all.mjs refuses a run it cannot make ===");
const baseEnv = { ...process.env }; delete baseEnv.WT_DIR; delete baseEnv.WT_DETECT;
// A run that gets past the gate starts the suite, which takes minutes; the bound turns that into
// a plain failure here instead of a hang. The gate itself answers in well under a second.
function node(args, extra, ms = 8000) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, env: { ...baseEnv, ...extra }, encoding: "utf8", timeout: ms, windowsHide: true });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), killed: r.status === null };
}
const ALL = path.join(ROOT, "tools", "all.mjs");
const emptyDir = dirOf(path.join(TMP, "empty-for-all"));
const namedRoot = path.join(TMP, "named", "War Thunder");
dirOf(path.join(namedRoot, "content", "base", "res"));
// A test that ran prints "PASS  id  what (1.2s)" or "FAIL ... (1.2s, exit 1)"; the gate's own line
// starts with FAIL too but carries no time, because nothing was timed.
const ranNothing = out => !/\bpassed\b/.test(out) && !/^(PASS|FAIL|SKIP)\s.*\(\d+\.\ds/m.test(out);
const oneLine = r => r.out.trim().split("\n").length <= 2;

for (const [label, dir] of [["an empty folder", emptyDir], ["a folder named War Thunder with no aces.vromfs.bin", namedRoot]]) {
  for (const args of [["--all"], [], ["--list"], ["--only", "check"]]) {
    const r = node([ALL, ...args], { WT_DIR: dir });
    const how = args.length ? args.join(" ") : "(plain npm test)";
    R.is(!r.killed && r.code !== 0 && r.out.includes(dir) && /not a War Thunder install/.test(r.out) && ranNothing(r.out) && oneLine(r),
      `all.mjs ${how}, WT_DIR = ${label}: exit ${r.code}${r.killed ? " (killed: it started running)" : ""}, one line naming it, nothing run → ${J(r.out.trim().slice(0, 240))}`);
  }
}
{
  const r = node([ALL, "--all"], { WT_DETECT: "0" });
  R.is(!r.killed && r.code !== 0 && /no War Thunder install/i.test(r.out) && ranNothing(r.out) && oneLine(r),
    `all.mjs --all with no install anywhere: exit ${r.code}, one line, no summary → ${J(r.out.trim().slice(0, 240))}`);
  const o = node([ALL, "--only", "arms"], { WT_DETECT: "0" });
  R.is(!o.killed && o.code !== 0 && /arms/.test(o.out) && /no War Thunder install/i.test(o.out) && ranNothing(o.out),
    `all.mjs --only arms with no install: exit ${o.code} → ${J(o.out.trim().slice(0, 200))}`);
  // The equals form is the same request. It used to be read as no filter at all, so with no install
  // it ran the whole install-free suite and exited 0 (final audit, 2026-10-10).
  for (const extra of [[], ["--list"]]) {
    const e = node([ALL, "--only=arms", ...extra], { WT_DETECT: "0" });
    R.is(!e.killed && e.code !== 0 && /arms/.test(e.out) && /no War Thunder install/i.test(e.out) && ranNothing(e.out),
      `all.mjs --only=arms ${extra.length ? extra.join(" ") + " " : ""}with no install: refused like --only arms, exit ${e.code} → ${J(e.out.trim().slice(0, 160))}`);
  }
  const u = node([ALL, "--bogus"], {});
  R.is(!u.killed && u.code === 2 && /unknown option "--bogus"/.test(u.out) && ranNothing(u.out),
    `an option all.mjs does not know is refused before anything runs, exit ${u.code} → ${J(u.out.trim().slice(0, 160))}`);
  // Controls: the gate is about the install, not about being asked at all.
  const l = node([ALL, "--list"], { WT_DETECT: "0" });
  R.is(l.code === 0 && /install: none found/.test(l.out), `control: --list with no install still lists, exit ${l.code}`);
  const good = game(path.join(TMP, "good", "War Thunder"));
  const g = node([ALL, "--list"], { WT_DIR: good });
  R.is(g.code === 0 && g.out.includes(good) && /WT_DIR/.test(g.out),
    `control: --list with a valid WT_DIR prints it and how it was found, exit ${g.code} → ${J((/install:.*$/m.exec(g.out) || [""])[0])}`);
  // An install test that exits 0 after a SKIP did not run. `layeredpsd` over an install with no
  // UserSkins folder says SKIP before it looks for a browser (so this holds on a machine with none),
  // about the install the header printed.
  const s = node([ALL, "--only", "layeredpsd"], { WT_DIR: good }, 30000);
  R.is(!s.killed && s.code === 1 && /^FAIL\s+layeredpsd .*did not run: SKIP/m.test(s.out) && s.out.includes(path.join(good, "UserSkins")) &&
    /0\/1 passed, 1 FAILED/.test(s.out),
    `an install test that exits 0 after SKIP is a failure → exit ${s.code}, ${J((/^FAIL.*$/m.exec(s.out) || [s.out.trim().slice(-200)])[0].slice(-200))}`);

  // A folder that passes the resolver's two cheap checks and holds nothing else — what a game update
  // that moved the packs would look like (CLAUDE.md §0.3) — must not let an install test pass: each
  // has to find something to test or fail. Measured on the first version of the resolver: a2d and rig
  // passed here, t27 printing "0 / 0 clips decoded … all good" (review of 2026-10-10). Every install
  // test all.mjs lists is run, so a new one is held too; `listedinstall` is left out only because it
  // drives the page in Chrome and fails here by timing out, 65 s (measured 2026-10-10).
  const SLOW_ON_A_SHELL = ["listedinstall"];
  const ids = [...g.out.matchAll(/^ {2}([a-z0-9]+)\s+not run \(needs --all\)/gm)].map(m => m[1]);
  const shellIds = ids.filter(id => !SLOW_ON_A_SHELL.includes(id));
  const shell = game(path.join(TMP, "shell", "War Thunder"));
  const sh = node([ALL, "--only", shellIds.join(",")], { WT_DIR: shell }, 60000);
  const passedOn = shellIds.filter(id => new RegExp("^PASS\\s+" + id + "\\s", "m").test(sh.out));
  const verdicts = shellIds.filter(id => new RegExp("^(PASS|FAIL)\\s+" + id + "\\s", "m").test(sh.out));
  R.is(["a2d", "rig", "arms"].every(id => shellIds.includes(id)) && !sh.killed && sh.code !== 0 && passedOn.length === 0 && verdicts.length === shellIds.length,
    `the ${shellIds.length} install tests over a folder holding only aces.vromfs.bin and content/base/res: none passes ` +
    `→ exit ${sh.code}${sh.killed ? " (killed)" : ""}, passed: ${J(passedOn)}, judged ${verdicts.length}/${shellIds.length}`);
}

// ---------------------------------------------------------------------------- standalone tools
console.log("\n=== the install tools on their own, with a wrong WT_DIR ===");
for (const [file, args] of [["t85_listed_install.mjs", []], ["t101_layered.mjs", ["--install"]],
                            ["t12_verify.mjs", []], ["t27_a2d.mjs", []], ["ctrl_sweep.mjs", []]]) {
  const r = node([path.join(ROOT, "tools", file), ...args], { WT_DIR: emptyDir }, 15000);
  R.is(!r.killed && r.code !== 0 && r.out.includes(emptyDir) && /not a War Thunder install/.test(r.out),
    `${file} ${args.join(" ")}: exit ${r.code}, says why → ${J(r.out.trim().split("\n").slice(-1)[0].slice(0, 200))}`);
}

// ---------------------------------------------------------------------------- what a SKIP means
// tools/verdict.mjs is all.mjs's one decision about a test's run. Held here as a function because
// the case that matters — a machine with no Chrome — cannot be made on a machine that has one:
// headless.mjs's findBrowser falls back to the installed browser whatever CHROME says.
console.log("\n=== a SKIP that means nothing ran is a failure ===");
const { verdict } = await import("./verdict.mjs");
const free = { needsInstall: false }, inst = { needsInstall: true };
const noChrome = verdict(free, { code: 0, out: "SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME.\n" });
R.is(noChrome.state === "fail" && /did not run/.test(noChrome.note),
  `an install-free test that found no browser and exited 0 fails → ${J(noChrome)}`);
const noChromeHalf = verdict(free, { code: 0, out: "  ok   the Node half\nSKIP (page half): no Chrome or Edge found. Pass --chrome <path> or set CHROME.\n" });
R.is(noChromeHalf.state === "fail", `so does one that ran only its Node half for want of a browser → ${J(noChromeHalf)}`);
const noGl = verdict(free, { code: 0, out: "  ok   canvas path\n  SKIP projector half: no WebGL context in this browser\n" });
R.is(noGl.state === "pass" && /part skipped: SKIP projector half/.test(noGl.note),
  `control: a part this browser cannot do (no WebGL) passes, and the SKIP is said beside it → ${J(noGl)}`);
const instSkip = verdict(inst, { code: 0, out: "SKIP: no PSD under D:/x/UserSkins\n" });
R.is(instSkip.state === "fail", `an install test that skipped fails, whatever the reason → ${J(instSkip)}`);
const plain = verdict(free, { code: 0, out: "  ok   everything\n" }), broke = verdict(free, { code: 1, out: "  FAIL x\n" });
R.is(plain.state === "pass" && !plain.note && broke.state === "fail",
  `controls: a clean exit 0 passes with nothing said, a non-zero exit fails → ${J(plain)}, ${J(broke)}`);

R.finish(`(${((Date.now() - started) / 1000).toFixed(1)} s)`);
