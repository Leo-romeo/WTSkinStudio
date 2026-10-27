// The preview server serves the build from memory and never writes the artifact.
//
// WHY THIS EXISTS. The scan of 2026-10-22 (ROADMAP 1.21 (5)), verified the same day: tools/serve.mjs
// rebuilt on every request for "/" and then wrote wt_skin_studio.html whenever it differed from the
// build. Opening the preview therefore silently reverted a hand-edit to the committed artifact —
// exactly the loss t41_build exists to catch rather than hide. The page it serves is the build
// either way; the write bought nothing but that.
//
// This starts the real server on a free port against a stand-in artifact holding a hand-edit
// (`--artifact`, so the suite's own wt_skin_studio.html is never touched while other tests read it),
// asks for "/", and holds that the page served is what `build()` makes and the stand-in is unchanged.
//
// Usage: node tools/t146_serve.mjs
import fs from "fs";
import os from "os";
import path from "path";
import net from "net";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { build } from "./build.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const is = (ok, msg) => { if (ok) pass++; else fail++; console.log((ok ? "ok   " : "FAIL ") + msg); };

const port = await new Promise(res => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t146-"));
const stand = path.join(dir, "wt_skin_studio.html");
const edited = "<!doctype html><title>a hand-edit</title>\n";
fs.writeFileSync(stand, edited);

const child = spawn(process.execPath, [path.join(here, "serve.mjs"), String(port), "--artifact", stand], { stdio: ["ignore", "pipe", "pipe"] });
let log = "";
child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
try {
  // ready when it says so, or 15 s
  const t0 = Date.now();
  while (!/serving/.test(log) && Date.now() - t0 < 15000 && child.exitCode === null) await new Promise(r => setTimeout(r, 50));
  is(/serving/.test(log), "the server starts" + (/serving/.test(log) ? "" : " — " + log.slice(0, 200)));
  const res = await fetch(`http://127.0.0.1:${port}/`);
  const html = await res.text();
  const { html: built } = build();
  is(res.status === 200 && html === built, `"/" is the build of src/, served from memory (${html.length} bytes, status ${res.status})`);
  const after = fs.readFileSync(stand, "utf8");
  is(after === edited, after === edited
    ? "the artifact on disk is not written — a hand-edit stays for t41 to catch"
    : `the artifact on disk was rewritten (${after.length} bytes) — a hand-edit would have been silently reverted`);
  is(/differs from the build/.test(log), `…and the server says the artifact on disk differs from what it serves (${JSON.stringify(log.split("\n").find(l => /differs/.test(l)) || "")})`);
} finally {
  child.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
