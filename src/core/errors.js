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
