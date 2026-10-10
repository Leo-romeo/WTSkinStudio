// The decoder slot, for the build that carries the project's own decoder — which is the default
// build, and the one you may give to anyone. `node tools/build.mjs` inlines this in place of
// `oodle-b64.js`.
//
// There is no blob: the decoder is `src/codecs/wtlz.js`, plain JavaScript in the page like every
// other codec, independently created and ours to ship (docs/WTLZ.md). `OODLE_IMPL` names it so the
// seam in `codecs/oodle.js` routes to it, the welcome card can say which decoder this is, and a bug
// report carries the answer. `OODLE_WASM_B64` stays declared, and empty, because the seam's WASM
// path and the decode pool's `ops` prelude both read it by name — the two diagnostic builds
// (`--ooz`, `--rad`) fill it, this one does not. CLAUDE.md §0.2 and §7.
const OODLE_IMPL = "wtlz";
const OODLE_WASM_B64 = "";
