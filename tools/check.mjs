// Extract every inline <script> from the page and syntax-check it.
import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

// Relative to this file, not an absolute path on one machine: `npm test` runs this, and a clone
// anywhere else read nothing and failed the suite on ENOENT.
const HTML = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "wt_skin_studio.html");
const src = fs.readFileSync(HTML, "utf8");
// Parsed in this process with vm.Script, as the browser parses a classic <script>. Until 2026-10-22
// each script was written to a fixed `os.tmpdir()/wtcheck` folder (shared by every run at once, and
// never emptied) and handed to its own `node --check`: 148 processes, 31 s of a parallel suite
// (ROADMAP 0.4). vm.Script compiles without running, which is all --check did; and it reads a
// script as a script, where --check on a loose .js file read it as a CommonJS module body.
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, i = 0, bad = 0, notes = 0;
while ((m = re.exec(src))) {
  i++;
  const body = m[1];
  const line = src.slice(0, m.index).split("\n").length;
  // RELEASE_NOTES.md's tag (ROADMAP 5.7, tools/build.mjs notesTag) is Markdown the page neither runs
  // nor fetches, so there is nothing in it to parse. Exactly that tag is passed over, by its type and
  // id, and counted apart; any other non-script block would still be parsed, and fail, here.
  if (/^<script type="text\/plain" id="releaseNotes">/.test(m[0])) {
    notes++;
    console.log(`script #${i} (page line ${line}, ${body.length} chars): RELEASE_NOTES.md text, not parsed`);
    continue;
  }
  try {
    new vm.Script(body, { filename: "inline" + i + ".js" });
    console.log(`script #${i} (page line ${line}, ${body.length} chars): OK`);
  } catch (e) {
    bad++;
    console.log(`script #${i} (page line ${line}): SYNTAX ERROR`);
    console.log(String(e.stack || e.message).split("\n").slice(0, 6).join("\n"));
  }
}
console.log(bad ? `\n${bad} of ${i} inline scripts failed` : `\nall ${i - notes} inline scripts parse (${notes} text block, the release notes, passed over)`);
process.exit(bad ? 1 : 0);
