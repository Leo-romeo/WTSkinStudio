// What one test's run means for the suite's exit code — tools/all.mjs's one decision, kept apart so
// tools/t133_wtdir.mjs can hold it without a machine that lacks Chrome or the install.
//
// A test that exits 0 is not necessarily a test that ran. Two ways of printing SKIP and exiting 0
// mean nothing was tested, and both count as a failure:
//   * an install test that skipped (t103 without the F-4E, t101 --install with no PSD in UserSkins,
//     every roster sweep when the install was missing — until 2026-10-10 that was a SKIP line per
//     sweep and a green run that had tested nothing);
//   * an install-free test that found no Chrome or Edge. About forty of them print
//     "SKIP: no Chrome or Edge found" and exit 0, so on a machine with no browser `npm test` used to
//     pass with its whole browser half unrun (final audit, 2026-10-10).
// Any other SKIP is a part of a test that this browser cannot do — no WebGL context for the GPU
// half (t38, t66, t67), no performance.memory (t45). The test still ran what it could; it passes,
// and the SKIP is said beside the PASS rather than dropped.
export function verdict(t, r) {
  const skip = r.code === 0 ? /^[ \t]*(SKIP\b.*)$/m.exec(r.out) : null;
  if (skip && (t.needsInstall || /no Chrome or Edge/i.test(skip[1])))
    return { state: "fail", note: "did not run: " + skip[1].trim() };
  if (r.code === 0) return { state: "pass", note: skip ? "part skipped: " + skip[1].trim() : "" };
  return { state: "fail", note: "" };
}
