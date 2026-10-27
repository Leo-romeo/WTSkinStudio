/*==ERRORS==*/
// ---------- Failures the user is told about ----------
// CLAUDE.md §4: errors are never silent, and there are no empty `catch {}`. Fifteen existed
// (ROADMAP 2.5); the ones that mattered all had the same shape — the app carried on and told the
// user nothing, so a failure was indistinguishable from a success with nothing in it. A prefs write
// that failed reset every setting on the next visit with no hint why. A thumbnail that failed to
// draw came back blank, which is exactly what an empty layer looks like.
//
// `setStatus` is the surface, deliberately: it is already where every other outcome is reported,
// and a second place to look is worse than a busy one. What this adds over calling it directly is
// that a failure on a timer (savePrefs runs every 4 s) says its piece once instead of every tick.
//
// NOT CALLED `reportError`, and that is not taste. `reportError()` is a real platform global
// (WindowOrWorkerGlobalScope.reportError) that throws its argument as an uncaught error. A
// top-level `function reportError` in a classic script shadows it — until the one script holding
// it is absent, and then every call site silently becomes the built-in and reports the *message
// string* as an uncaught exception. Measured 2026-08-06, by removing this file: the decal library
// test failed with six "Uncaught Could not save to this browser's storage (decalIndex)". Worse, a
// section lifted into a worker gets the built-in too, with no script missing at all. Never give a
// global here a name the platform already owns.
const ERR_REPEAT_MS = 30000;                 // the same failure, again, is not news
const errSeen = new Map();                   // key -> when it was last put in front of the user

// `what` is what the USER was doing, in their words — not the name of the function that threw.
// `key` groups repeats; it defaults to `what`, which is usually the same thing.
function reportFailure(what, err, key){
  console.error(what + ":", err);            // development only (§4) — the status line is the user's
  const k = key || what;
  const now = Date.now();
  if (now - (errSeen.get(k) || 0) < ERR_REPEAT_MS) return;
  errSeen.set(k, now);
  setStatus(what + " — " + errText(err), "err");
}

// Something that failed and then started working again should be allowed to report again at once,
// rather than staying quiet for the rest of the repeat window.
function clearFailure(key){ errSeen.delete(key); }

// The cap was 160, sized to a status line that could show 70 of them anyway. The line's log shows
// every message in full now (ui/dom.js, StatusLog), so this only guards against a message that is
// really a dump — a stack, or a file's worth of text quoted back.
function errText(err){
  if (!err) return "no reason given";
  const m = (err && err.message) || String(err);
  return m.length > 600 ? m.slice(0, 599) + "…" : m;
}

// A thumbnail that could not be drawn must not come back blank: blank is what an empty layer looks
// like, so the one case the user can act on was rendered as the one case they cannot. A hatched box
// costs nothing and is unmistakable at 26 px. Draws on a canvas the caller owns and returns it, so
// it slots straight into a `catch`.
function brokenThumb(c, err, what){
  if (err) console.error((what || "thumbnail") + ":", err);
  const g = ctx2d(c), w = c.width, h = c.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.filter = "none";
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#2a2d34"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#6b7280"; g.lineWidth = Math.max(1, Math.round(w / 48));
  g.beginPath();
  for (let x = -h; x < w; x += Math.max(4, Math.round(w / 4))) { g.moveTo(x, h); g.lineTo(x + h, 0); }
  g.stroke();
  g.strokeStyle = "#9aa3af";
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
  if (c.title !== undefined) c.title = (what || "This thumbnail") + " could not be drawn";
  return c;
}
/*==ENDERRORS==*/

// ---------- What nothing caught ----------
// An exception thrown in a click handler, a timer or a frame callback, and a promise nobody awaited,
// went to the console and nowhere else: the button did nothing and the user was told nothing.
// (docs/AGENT_ACCESS.md §11 found the gap, 2026-10-17.) Each now goes through reportFailure like
// every other failure, so it is on the status line and in Messages. The key is where it happened
// plus what it says, so an error thrown on every pointermove says its piece once.
//
// WHERE is in the message, because what a user copies out of Messages may be the only report the
// author ever sees. It reads `src/<file>:<line>:<col>`: every inlined script carries a `//# sourceURL`
// naming its file (tools/build.mjs), and a pool's worker one naming the pool (workers/pool.js). For
// a throw that is the event's own location. A rejection carries only its reason, and the first frame
// of that reason's stack that has a position is where the error was made.
//
// It never calls preventDefault(). A listener that does silences the console's own "Uncaught" entry
// (measured 2026-10-17 on Chrome 155). The console is where a developer reads the whole stack, and
// it is where tools/headless.mjs's trap, the one t31_boot fails on at load, has to see the error.
//
// Two things are not failures and are not reported. An AbortError is a cancel, which every caller
// here already treats as silent (export/pipeline.js, game/skins.js, ui/welcome.js). "ResizeObserver
// loop …" is the browser saying it moved some resize notifications to the next frame; it arrives as
// an ErrorEvent with no error in it.
//
// Registered as this script runs, not at the end of boot. setStatus and StatusLog (ui/dom.js) are
// already up, so a module after this one that throws while the page loads is reported too. It sits
// outside the ERRORS section, so a lift of that section stays free of `window`.
// tools/t142_uncaught.mjs holds all of it.
(function trapUncaught(){
  const frame = err => {
    const m = /\n\s*at (?:[^\n]*?\()?([^\s()]+):(\d+):(\d+)\)?/.exec(String((err && err.stack) || ""));
    return m ? m[1] + ":" + m[2] + ":" + m[3] : "";
  };
  const say = (err, where) => {
    if (err && err.name === "AbortError") return;
    reportFailure("Unexpected error" + (where ? " at " + where : ""), err, "uncaught " + where + " " + errText(err));
  };
  window.addEventListener("error", e => {
    if (e.error == null && /^ResizeObserver loop/.test(e.message || "")) return;
    say(e.error != null ? e.error : e.message, e.filename ? e.filename + ":" + e.lineno + ":" + e.colno : frame(e.error));
  });
  window.addEventListener("unhandledrejection", e => say(e.reason, frame(e.reason)));
})();
