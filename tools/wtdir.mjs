// Where the War Thunder install is — the ONE place any tool asks. Read-only, always.
//
// WHY THIS EXISTS. Every install tool used to carry its own `process.env.WT_DIR || "<a path>"`, and
// the path rotted twice: the dev install left D:\SteamLibrary on 2026-09-07 while ~20 tools named it
// until 2026-09-20, and on 2026-10-10 it went back to D:\SteamLibrary while the same tools named
// C:\Program Files (x86)\Steam. Both times `npm run test:all` printed SKIP for every roster sweep and
// exited 0 — a green run that had tested nothing (docs/CLAUDE_HISTORY.md §6). So nothing here has a
// default path any more; it asks the machine, in this order, and says which way it found it:
//
//   1. WT_DIR, when set. It must then BE an install, or findInstall throws naming the path and what
//      is missing: an explicitly wrong path is a misconfiguration, never swapped for a found one.
//   2. Steam. Its own list of library folders (steamapps/libraryfolders.vdf) under the usual Steam
//      folders; the registry's SteamPath only when none of those has the list. Libraries the list
//      shows holding app 236390 are tried first, at steamapps/common/<the manifest's installdir>.
//   3. The usual folders: the Gaijin launcher's %LOCALAPPDATA%\WarThunder and a short list of
//      common roots on each drive that exists.
//
// WT_DETECT=0 turns 2 and 3 off — what a machine without the game sees, and what t133 drives.
//
// What counts as an install, measured 2026-10-10 against what the tools read: aces.vromfs.bin at the
// root (arms.mjs, camo_sweep, t85 — every unit, weapon and skin blk is in it) and content/base/res
// (where every .grp and .dxp.bin the roster sweeps walk lives: 1 050 files in this install). Two
// stats; a folder with both is a War Thunder root in every layout seen, Steam's and the launcher's.
//
// Cost, measured 2026-10-10 on the dev machine: 0.7–2.3 ms when Steam's own folder has the list (two
// vdf reads and a handful of stats), which is the common case and needs no process. `reg query` is
// 25–33 ms a call, so it runs only when the usual Steam folders have no readable list. A drive that
// has spun down costs what waking it costs (465 ms for one stat on E:, a WD10EZEX) — the reason the
// fallback roots come last. Nothing resolves at import: install-free tests import modules that import
// this one, and must not pay for it.
//
// Every function takes its roots as parameters (`env`, `platform`, `steamRoots`, `registry`,
// `fallbackRoots`), so tools/t133_wtdir.mjs can point it at a Steam layout it builds in a temp folder.
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

export const STEAM_APP = "236390";
const MARKERS = [
  { rel: "aces.vromfs.bin", dir: false },
  { rel: path.join("content", "base", "res"), dir: true },
];

export class InstallError extends Error {
  constructor(message) { super(message); this.name = "InstallError"; }
}

function statOf(p) {
  try { return fs.statSync(p, { throwIfNoEntry: false }) || null; }
  catch { return null; }   // ENOTDIR, EACCES, a drive with no disc: all "not here", which is the answer
}
function readText(p) {
  const st = statOf(p);
  if (!st || !st.isFile()) return null;
  return fs.readFileSync(p, "utf8");
}

// What a folder lacks to be a War Thunder root; [] when it is one.
export function installProblems(dir) {
  const st = statOf(dir);
  if (!st) return ["the folder itself (it does not exist)"];
  if (!st.isDirectory()) return ["the folder itself (it is a file)"];
  const missing = [];
  for (const m of MARKERS) {
    const s = statOf(path.join(dir, m.rel));
    if (!s || s.isDirectory() !== m.dir) missing.push(m.dir ? m.rel + " folder" : m.rel);
  }
  return missing;
}

// Valve's KeyValues text: quoted keys, a quoted value or a { block }, // comments. Steam writes every
// token quoted; an unquoted one is read up to whitespace or a brace, which is what Valve's reader does.
export function parseVdf(text) {
  let i = 0;
  const n = text.length;
  const skip = () => {
    while (i < n) {
      if (text[i] === "/" && text[i + 1] === "/") { while (i < n && text[i] !== "\n") i++; }
      else if (text.charCodeAt(i) <= 32) i++;
      else break;
    }
  };
  const token = () => {
    if (text[i] !== '"') {
      const a = i;
      while (i < n && text.charCodeAt(i) > 32 && text[i] !== "{" && text[i] !== "}") i++;
      return text.slice(a, i);
    }
    let s = "";
    for (i++; i < n && text[i] !== '"'; i++) {
      if (text[i] === "\\" && i + 1 < n) { const e = text[++i]; s += e === "n" ? "\n" : e === "t" ? "\t" : e; }
      else s += text[i];
    }
    if (i >= n) throw new Error("unterminated string");
    i++;
    return s;
  };
  const block = top => {
    const o = {};
    for (;;) {
      skip();
      if (i >= n) { if (top) return o; throw new Error("unexpected end inside a block"); }
      if (text[i] === "}") { if (top) throw new Error("unmatched } at " + i); i++; return o; }
      const k = token();
      skip();
      if (text[i] === "{") { i++; o[k] = block(false); }
      else if (i < n) o[k] = token();
      else throw new Error("key " + JSON.stringify(k) + " has no value");
    }
  };
  return block(true);
}
const pick = (o, key) => {
  if (!o || typeof o !== "object") return undefined;
  const k = Object.keys(o).find(x => x.toLowerCase() === key);
  return k === undefined ? undefined : o[k];
};

// The libraries one libraryfolders.vdf lists, each with whether its apps list holds War Thunder.
// The format before 2021 maps "1" → "D:\\SteamLibrary" and leaves the Steam folder itself out.
export function steamLibraries(text, steamRoot) {
  const top = pick(parseVdf(text), "libraryfolders");
  if (!top || typeof top !== "object") throw new Error("no libraryfolders block");
  const libs = [];
  for (const [k, v] of Object.entries(top)) {
    if (!/^\d+$/.test(k)) continue;
    if (typeof v === "string") libs.push({ path: v, listed: false });
    else if (typeof pick(v, "path") === "string") {
      const apps = pick(v, "apps");
      libs.push({ path: pick(v, "path"), listed: !!apps && typeof apps === "object" && Object.hasOwn(apps, STEAM_APP) });
    }
  }
  if (!libs.some(l => samePath(l.path, steamRoot))) libs.unshift({ path: steamRoot, listed: false });
  // listed first; otherwise the list's own order (sort is stable)
  return libs.sort((a, b) => b.listed - a.listed);
}

const samePath = (a, b) => process.platform === "win32"
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

function home(env) { return env.HOME || env.USERPROFILE || os.homedir(); }

export function defaultSteamRoots(env = process.env, platform = process.platform) {
  if (platform === "win32") {
    const out = [path.join(env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Steam"),
                 path.join(env.ProgramFiles || "C:\\Program Files", "Steam")];
    return out.filter((p, i) => out.findIndex(q => samePath(p, q)) === i);
  }
  if (platform === "darwin") return [path.join(home(env), "Library", "Application Support", "Steam")];
  return [path.join(home(env), ".steam", "steam"), path.join(home(env), ".local", "share", "Steam"),
          path.join(home(env), ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam")];
}

// Steam's folder as the registry has it: HKCU's SteamPath ("c:/program files (x86)/steam" on the dev
// machine), and HKLM's InstallPath only if HKCU has none.
export function registrySteamRoots(platform = process.platform) {
  if (platform !== "win32") return [];
  for (const [key, value] of [["HKCU\\Software\\Valve\\Steam", "SteamPath"],
                              ["HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"]]) {
    let out;
    try {
      out = execFileSync("reg", ["query", key, "/v", value],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000, windowsHide: true });
    } catch { continue; }   // no such key: Steam was never installed this way, which is the answer
    const m = new RegExp(value + "\\s+REG_(?:EXPAND_)?SZ\\s+(.+)", "i").exec(out);
    if (m) return [path.win32.normalize(m[1].trim())];
  }
  return [];
}

export function defaultFallbackRoots(env = process.env, platform = process.platform) {
  const out = [];
  if (platform === "win32") {
    if (env.LOCALAPPDATA) out.push(path.join(env.LOCALAPPDATA, "WarThunder"));   // the Gaijin launcher's default
    for (const d of ["C", "D", "E", "F"]) {
      if (!statOf(d + ":\\")) continue;
      for (const rel of ["SteamLibrary\\steamapps\\common\\War Thunder", "Steam\\steamapps\\common\\War Thunder",
                         "Games\\War Thunder", "Games\\WarThunder", "War Thunder", "WarThunder"]) out.push(d + ":\\" + rel);
    }
  } else if (platform !== "darwin") {
    out.push(path.join(home(env), "WarThunder"), path.join(home(env), "Games", "War Thunder"));
  }
  return out;
}

// One sentence on why a folder is not an install, for an error a person reads.
function notAnInstall(dir, missing) {
  if (/does not exist/.test(missing[0])) return `"${dir}" does not exist`;
  if (/is a file/.test(missing[0])) return `"${dir}" is a file, not a folder`;
  return `"${dir}" is not a War Thunder install: it has no ${missing.join(" and no ")}`;
}

/**
 * Find the install. Returns { dir, how, detail, tried, reason, ms }: `dir` null when none was found,
 * `how` "env" | "steam" | "fallback", `detail` how exactly, `tried` the folders that were candidates
 * and what each lacked, `reason` one line on why nothing was found. Throws InstallError when WT_DIR
 * is set and is not an install.
 */
export function findInstall(opts = {}) {
  const t0 = performance.now();
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const done = r => ({ tried: [], reason: null, ...r, ms: performance.now() - t0 });

  const explicit = (env.WT_DIR || "").trim();
  if (explicit) {
    const dir = path.resolve(explicit);
    const missing = installProblems(dir);
    if (missing.length) {
      const inner = path.join(dir, "War Thunder");
      const hint = installProblems(inner).length ? "" : ` (the "War Thunder" folder inside it is one)`;
      throw new InstallError(`WT_DIR is set, and ${notAnInstall(dir, missing)}${hint}. ` +
        `Point WT_DIR at the folder holding aces.vromfs.bin, or unset it and the tools find the install themselves.`);
    }
    return done({ dir, how: "env", detail: "WT_DIR" });
  }
  if (env.WT_DETECT === "0") {
    return done({ dir: null, how: null, detail: null, reason: "WT_DIR is not set and WT_DETECT=0 turns the search off" });
  }

  const tried = [], lists = [];
  const fromSteam = (roots, via) => {
    for (const root of roots) {
      const vdfPath = path.join(root, "steamapps", "libraryfolders.vdf");
      const text = readText(vdfPath);
      if (text === null) continue;
      let libs;
      // A damaged list counts as no list, so the registry's Steam folder still gets asked.
      try { libs = steamLibraries(text, root); }
      catch (e) { tried.push({ dir: vdfPath, missing: [], note: "could not be read as a library list (" + e.message + ")" }); continue; }
      lists.push(vdfPath);
      for (const lib of libs) {
        const apps = path.join(lib.path, "steamapps");
        const acf = readText(path.join(apps, `appmanifest_${STEAM_APP}.acf`));
        let installdir = "War Thunder";
        if (acf !== null) {
          try { const d = pick(pick(parseVdf(acf), "appstate"), "installdir"); if (typeof d === "string" && d) installdir = d; }
          catch { /* a damaged manifest: Steam's own folder name for the game is the answer left */ }
        }
        const dir = path.join(apps, "common", installdir);
        const missing = installProblems(dir);
        if (!missing.length) {
          return { dir, how: "steam",
            detail: `library ${lib.path}, ${lib.listed ? "listed with app " + STEAM_APP : "searched"} in ${vdfPath}${via ? " (" + via + ")" : ""}` };
        }
        if (lib.listed || acf !== null) tried.push({ dir, missing, why: `${vdfPath} lists app ${STEAM_APP} there` });
      }
    }
    return null;
  };

  const steamRoots = opts.steamRoots || defaultSteamRoots(env, platform);
  let found = fromSteam(steamRoots, null);
  if (found) return done({ ...found, tried });
  if (!lists.length) {
    const reg = (opts.registry || registrySteamRoots)(platform).filter(r => !steamRoots.some(s => samePath(r, s)));
    found = fromSteam(reg, "Steam's folder from the registry");
    if (found) return done({ ...found, tried });
  }

  const fallbacks = opts.fallbackRoots || defaultFallbackRoots(env, platform);
  for (const dir of fallbacks) {
    const missing = installProblems(dir);
    if (!missing.length) return done({ dir, how: "fallback", detail: "a usual install folder", tried });
    if (!/does not exist/.test(missing[0])) tried.push({ dir, missing });
  }

  const parts = ["WT_DIR is not set"];
  parts.push(lists.length ? `no Steam library in ${lists.join(", ")} holds it` : "no readable Steam library list was found");
  for (const t of tried) parts.push(t.note ? `"${t.dir}" ${t.note}` : notAnInstall(t.dir, t.missing) + (t.why ? ` though ${t.why}` : ""));
  parts.push(`and none of the ${fallbacks.length} usual folders is one`);
  return done({ dir: null, how: null, detail: null, tried, reason: parts.join("; ") });
}

// One line for a header: where, and how it was found.
export function describeInstall(r) {
  if (!r.dir) return `none found (${r.reason})`;
  const how = r.how === "env" ? "from WT_DIR" : r.how === "steam" ? "found through Steam: " + r.detail : "found in " + r.detail;
  return `${r.dir}  (${how}; ${r.ms.toFixed(1)} ms)`;
}

let cached = null;
// The install for a tool that cannot run without it. Resolved on the first call, not at import.
export function installDir() {
  if (!cached) cached = findInstall();
  if (!cached.dir) {
    throw new InstallError(`No War Thunder install found: ${cached.reason}. ` +
      `Set WT_DIR to the install folder (the one holding aces.vromfs.bin).`);
  }
  return cached.dir;
}

// The same, for a standalone tool: a missing or wrong install is one line and a non-zero exit, not a
// SKIP that exits 0 and not a stack trace.
export function installOrExit() {
  try { return installDir(); }
  catch (e) {
    if (!(e instanceof InstallError)) throw e;
    console.error("FAIL: " + e.message);
    process.exit(1);
  }
}
