// The Oodle decoder, deliberately absent. This file is what `node tools/build.mjs --no-oodle`
// inlines in place of `oodle-b64.js`.
//
// **This is no longer the release build.** It used to be the only form of the app that could be
// given to anyone, because the alternative was RAD's EULA-encumbered blob. Since 2026-08-22 the
// release build is `--public`, which ships `ooz` (GPL-3) and reads the whole game. What this
// configuration is for now is keeping the no-decoder path honest, and being the fallback if ooz
// ever has to be dropped.
//
// WHY IT EXISTS AT ALL. `oodle-b64.js` holds RAD Oodle Data compiled from the Unreal Engine SDK
// source, which is governed by the UE EULA. It is licensed for use with your own install;
// redistributing it is not ours to do. See CLAUDE.md §0.2 and §7, and the `wt-distribution` skill.
//
// WHAT A BUILD WITHOUT IT CAN STILL DO. Everything except reading Oodle-compressed entries out of
// the game's own packs. The manual OBJ/DDS import path is untouched (CLAUDE.md §0.3), zstd- and
// zlib-compressed and raw entries decode normally, and an Oodle entry is listed, dimmed, tagged and
// explained rather than silently missing — `oodleAvailable()` is false, so `supported` is false for
// those entries and nothing ever reaches the decoder. That is the honest failure mode, and
// `tools/t42_nooodle.mjs` is what says it stays honest.
//
// The empty string is load-bearing: `oodleAvailable()` tests truthiness, and the decode pool passes
// this value through `ops` to its workers, so they degrade identically (CLAUDE.md §3.1).
const OODLE_IMPL = "";
const OODLE_WASM_B64 = "";
