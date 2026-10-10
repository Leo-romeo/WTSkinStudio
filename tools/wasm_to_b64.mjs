// Wrap a .wasm file as one of the base64 `<script>` sources in src/vendor/.
//
//   node tools/wasm_to_b64.mjs <in.wasm> <out.js> --const OODLE_WASM_B64 --header <file>
//
// The app is one HTML file with no network (CLAUDE.md §0.1), so a WASM module reaches it as a
// base64 string in a script tag. Keeping that mechanical — rather than pasted by hand — is what
// makes "rebuild the decoder and re-vendor it" a two-command operation, and it is why the header
// comment lives in its own file next to the build script that produced the binary.
import fs from "fs";
import path from "path";

const argv = process.argv.slice(2);
const opt = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const [inFile, outFile] = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
if (!inFile || !outFile) {
  console.error("usage: node tools/wasm_to_b64.mjs <in.wasm> <out.js> [--const NAME] [--header header.txt]");
  process.exit(2);
}
const constName = opt("--const", "OODLE_WASM_B64");
const headerFile = opt("--header", null);

const bin = fs.readFileSync(inFile);
if (bin.readUInt32LE(0) !== 0x6d736100) throw new Error(`${inFile} is not a WASM module (bad magic)`);
const header = headerFile ? fs.readFileSync(headerFile, "utf8").replace(/\s*$/, "\n") : "";
fs.writeFileSync(outFile, header + `const ${constName} = "${bin.toString("base64")}";\n`);

const kb = n => (n / 1024).toFixed(0) + " KB";
console.log(`${path.basename(outFile)} — ${kb(bin.length)} of WASM, ${kb(fs.statSync(outFile).size)} of source`);
