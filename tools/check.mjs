// Extract every inline <script> from the page and syntax-check it with node --check.
import fs from "fs";
import { execFileSync } from "child_process";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

// Relative to this file, not an absolute path on one machine: `npm test` runs this, and a clone
// anywhere else read nothing and failed the suite on ENOENT.
const HTML = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "wt_skin_studio.html");
const src = fs.readFileSync(HTML, "utf8");
const tmp = process.env.SCRATCH || path.join(os.tmpdir(), "wtcheck");
fs.mkdirSync(tmp, { recursive: true });

const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, i = 0, bad = 0;
while ((m = re.exec(src))) {
  i++;
  const body = m[1];
  const line = src.slice(0, m.index).split("\n").length;
  const f = path.join(tmp, "inline" + i + ".js");
  fs.writeFileSync(f, body);
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
    console.log(`script #${i} (page line ${line}, ${body.length} chars): OK`);
  } catch (e) {
    bad++;
    console.log(`script #${i} (page line ${line}): SYNTAX ERROR`);
    console.log(String(e.stderr || e.stdout || e.message));
  }
}
console.log(bad ? `\n${bad} of ${i} inline scripts failed` : `\nall ${i} inline scripts parse`);
process.exit(bad ? 1 : 0);
