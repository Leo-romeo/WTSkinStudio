// The page's Oodle-format decoder, lifted for Node the way the decode worker lifts it in the
// browser: the OODLE seam plus WTLZ when the build carries it, with the vendored slot's two
// constants in scope. Whatever decoder the build was made with — the project's own (wtlz, the
// build that ships), ooz or RAD's in the two diagnostic builds — comes out behind the same three
// names, so a roster tool never has to know which.
//
// Why one copy: eight install-dependent tools each carried their own lift, and three of them were
// a hand-written RAD-only shim (`ensureOodleSync` over `OODLE_WASM_B64`) that broke the day the
// shipped page stopped carrying RAD's blob (2026-09-14, ROADMAP 5.1) — and nobody saw, because the
// install had moved on 2026-09-07 and `npm run test:all` had been skipping every roster sweep
// since. The five others read the blob as their "is Oodle available" test, which is the same
// break with a quieter failure. Found 2026-09-20 when the sweeps ran again.
export function section(src, name) {
  const a = src.indexOf("\n/*==" + name + "==*/");
  const b = src.indexOf("\n/*==END" + name + "==*/");
  if (a < 0 || b < 0) return null;
  return src.slice(a + 1, b);
}
export function oodleFrom(html) {
  const blob = /const OODLE_WASM_B64 = "([^"]*)";/.exec(html);
  const impl = /const OODLE_IMPL = "([^"]*)";/.exec(html);
  const oodle = section(html, "OODLE");
  if (!oodle) throw new Error("section OODLE not found in the built page");
  return new Function("var OODLE_IMPL = " + JSON.stringify(impl ? impl[1] : "") + ";\n" +
    "var OODLE_WASM_B64 = " + JSON.stringify(blob ? blob[1] : "") + ";\n" +
    (section(html, "WTLZ") || "") + "\n" + oodle + "\nreturn { ensureOodle, oodleDecompress, oodleAvailable, oodleImpl };")();
}
// Put the three names where the page's own MODEL / DDS sections, run under `new Function`, will
// find them as free globals — which is how every roster tool runs those sections.
export function installOodle(html) {
  const O = oodleFrom(html);
  globalThis.ensureOodle = O.ensureOodle;
  globalThis.oodleDecompress = O.oodleDecompress;
  globalThis.oodleAvailable = O.oodleAvailable;
  return O;
}
