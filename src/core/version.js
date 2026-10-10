// What build is this? A release artifact that cannot answer that question makes every bug report
// start with a guess. Two facts, both shown on the welcome card and both worth having in a report:
//
//   APP_VERSION  matches package.json exactly — tools/t41_build.mjs fails the suite if it drifts,
//                which is the whole reason this is a hand-written constant rather than something
//                the build substitutes in (tools/build.mjs is a concatenation and stays one).
//   the decoder  comes from oodleImpl(). Since 2026-09-14 there is one build and it carries the
//                project's own decoder (docs/WTLZ.md), so the normal answer is "own decoder" and
//                saying so is a statement rather than a warning. The other three still exist and
//                still need naming in a bug report: `--ooz` is the diagnostic that carries ooz
//                (GPL-3, the reference the own decoder was measured against), `--rad` the one that
//                carries RAD's blob (CLAUDE.md §0.2, never redistributed), and `--no-oodle`
//                carries none at all, where "a vehicle will not load" is expected.
// The line restarted at 1.0.0-beta.1 on 2026-10-03 (ROADMAP 5.5(5)): the 0.x numbers were never
// published, so the first public build is the first number anyone outside sees.
const APP_VERSION = "1.0.0-beta.1";

// e.g. "v1.0.0-beta.1 · own decoder" / "v1.0.0-beta.1 · ooz decoder (local build)" /
//      "v1.0.0-beta.1 · RAD decoder (local build)" / "v1.0.0-beta.1 · no Oodle decoder"
function appBuildLabel(){
  const impl = oodleImpl();
  return "v" + APP_VERSION + " · " +
    (impl === "wtlz" ? "own decoder" : impl === "ooz" ? "ooz decoder (local build)"
     : impl === "rad" ? "RAD decoder (local build)" : "no Oodle decoder");
}
