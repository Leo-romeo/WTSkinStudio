// A static server for the built page, so the browser preview can open it.
//
// WHY THIS EXISTS. `.claude/launch.json` named `npm run dev` on port 3000, and `npm run dev` is
// `build.mjs --watch` — a file watcher that serves nothing. Anything driving the preview by that
// config got a watcher and a dead port. The alternative, opening the artifact as a `file://` URL,
// is worse than it sounds: the preview pane renders `file://` pages in a ZERO-SIZE viewport
// (`innerWidth === 0`), so nothing lays out and pointer coordinates are meaningless.
//
// This is a dev convenience and not part of the product. CLAUDE.md §0.1 — the artifact must open
// from a double-click with no server and no network — is unchanged and is what `t31_boot.mjs`
// actually tests; it loads the file directly and would catch any drift into needing this.
//
// Binds to 127.0.0.1 only: nothing here should ever be reachable from off the machine (§0.1).
//
// It rebuilds on every request for `/`, so a reload is the whole edit loop and there is no second
// process to run alongside. That is affordable because the build is a concatenation with no
// dependencies: 113 ms measured 2026-09-03.
//
// It never WRITES the artifact. It used to write wt_skin_studio.html back whenever it differed from
// the build, so opening the preview silently reverted a hand-edit to it — the loss t41_build exists
// to catch, not hide (ROADMAP 1.21 (5), 2026-10-22). It says when the file on disk differs instead;
// `npm run build` is what writes it. `t146_serve` holds this against a stand-in (`--artifact`).
//
// Usage: node tools/serve.mjs [port] [--artifact <path>]     (default 3000, the repo's artifact)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./build.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const PORT = Number(argv[0]) || 3000;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".dds": "application/octet-stream", ".wtproj": "application/json",
};

const ARTIFACT = argv.includes("--artifact") ? path.resolve(argv[argv.indexOf("--artifact") + 1]) : path.join(ROOT, "wt_skin_studio.html");
let drifted = false;                       // said once per change of state, not on every reload

http.createServer((req, res) => {
  // "/" is the product. Everything else resolves under ROOT, and must stay under it.
  // A malformed escape (`/%E0%A4%A`) makes decodeURIComponent throw, and a throw out of this
  // handler is an uncaught exception that takes the whole server down with it.
  let url;
  try { url = decodeURIComponent(req.url.split("?")[0]); }
  catch { res.writeHead(400, { "content-type": "text/plain" }).end("malformed URL"); return; }
  if (url === "/") {
    // A build failure must be visible as a build failure. Serving the last good artifact instead
    // would show a page that does not match src/, which is the one thing a preview must never do.
    let html;
    try { ({ html } = build()); } catch (err) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" })
         .end("build failed — the page below src/ did not compile:\n\n" + (err.stack || err.message));
      return;
    }
    // Served from the build itself, from memory: `build()` returns the page and writes nothing. This
    // used to read the artifact off disk (so the preview showed whatever `npm run build` last wrote,
    // not src/), and then to write it back when it differed — see the header for what that cost.
    let differs;
    try { differs = !fs.existsSync(ARTIFACT) || fs.readFileSync(ARTIFACT, "utf8") !== html; }
    catch (err) { differs = true; }
    if (differs !== drifted) {
      drifted = differs;
      console.log(differs ? "note: " + path.basename(ARTIFACT) + " on disk differs from the build of src/ being served — run `npm run build` to write it (t41 fails until then)"
                          : "note: " + path.basename(ARTIFACT) + " on disk matches the build again");
    }
    res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" }).end(html);
    return;
  }
  const rel = url.replace(/^\/+/, "");
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    res.writeHead(403).end("outside the repo");
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain" }).end("not found: " + rel); return; }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",          // --watch rebuilds; a cached page hides the rebuild
    }).end(buf);
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}/  (Ctrl+C to stop)`);
  console.log("  /  ->  wt_skin_studio.html");
});
