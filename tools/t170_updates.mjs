// Check for updates and What's new (ROADMAP 5.7, the owner's request of 2026-10-23, steps 1, 2 and 4).
//
// WHY THIS EXISTS. It is the one request the app may make (CLAUDE.md §0.1), so what it may and may not
// do is held here rather than trusted: nothing is asked before the click, the click asks exactly one
// address, carries nothing of the user's, and what comes back — Markdown written by whoever controls
// the release — is drawn as text. Served from fixtures through CDP request interception (Fetch), so
// the suite never touches the network: every request the page makes while the interception is on is
// answered here or failed here, and counted.
//
//   1. version order: beta.2 < beta.10 < 1.0.0, a pre-release below its release
//   2. the boot asked for nothing off the machine (t31 holds the boot with the network off; this
//      holds that the same page, network on, still made no request)
//   3. Check: one request to the release list, no cookie or referrer, newer builds newest first with
//      their notes, markup in them shown as text, a draft and older builds left out, the link
//   4. the other outcomes: newest, ahead of every release, rate-limited, offline, a non-list
//   5. the embedded notes are RELEASE_NOTES.md's section for this version, show once after a
//      version change (and on an upgrade from a build before this one), never on a first run or a
//      downgrade, and again from the panel
//
// Usage: node tools/t170_updates.mjs [--keep] [--chrome <path>]
import fs from "node:fs";
import path from "node:path";
import { findBrowser, evalInPage, pageExpr, makeReport, ROOT } from "./headless.mjs";

const argv = process.argv.slice(2);
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }
const R = makeReport();
const API = "https://api.github.com/repos/Leo-romeo/WTSkinStudio/releases";
const PAGE = "https://github.com/Leo-romeo/WTSkinStudio/releases";
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const notesMd = fs.readFileSync(path.join(ROOT, "RELEASE_NOTES.md"), "utf8").replace(/\r\n/g, "\n");

const rel = (tag, extra) => Object.assign({ tag_name: "v" + tag, name: "WT Skin Studio v" + tag, draft: false, prerelease: false,
  published_at: "2026-11-0" + (tag.length % 9) + "T12:00:00Z", html_url: PAGE + "/tag/v" + tag, body: "- notes of " + tag,
  assets: [{ name: "wt_skin_studio.html", size: 3617008 }] }, extra || {});
const FIXTURES = {
  newer: [rel("1.0.0-beta.9", { body: "### What's new\n\n- **Bold** and `code` <img src=x onerror=\"window.__pwned=1\"><b>tag</b>\n  [a link](https://evil.example/)" }),
    rel("1.0.0"), rel("9.9.9", { draft: true }), rel("1.0.0-beta.10"), rel(version), rel("1.0.0-beta.1"), { tag_name: "nightly" }],
  newest: [rel(version), rel("1.0.0-beta.1")],
  ahead: [rel("0.9.0"), rel("0.8.0")],
  notlist: { message: "Not Found" },
};

const BODY = `async function(){
  var out = {};
  out.order = [["1.0.0-beta.2","1.0.0-beta.10"],["1.0.0-beta.10","1.0.0"],["1.0.0-beta.2","1.0.0"],["1.0.0","1.0.1"],
    ["1.0.0-alpha","1.0.0-beta"],["1.0.0-beta","1.0.0-beta.1"],["1.0.0-1","1.0.0-beta"],["v1.2.3","1.2.3"],["1.10.0","1.9.0"]]
    .map(function(p){ return Updates.cmp(p[0], p[1]); });
  out.bad = Updates.cmp("nightly", "1.0.0");
  out.bootRequests = performance.getEntriesByType("resource").map(function(e){ return e.name; }).filter(function(u){ return /^(https?|wss?):/.test(u); });
  out.version = APP_VERSION;
  out.embedded = Updates.embedded();
  out.own = Updates.ownNotes();
  out.stamp = { status: document.getElementById("statusVersion").textContent, card: document.getElementById("buildStamp").textContent };
  return out;
}`;

// One check through the page's own panel: open from the status bar, click Check, wait for the answer.
const CHECK = `(async function(){
  if (window.Updates && Updates.close) Updates.close();
  document.getElementById("statusVersion").click();
  var p = document.getElementById("updPanel");
  if (!p) return { err: "no panel" };
  document.getElementById("updCheck").click();
  var t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    var r = document.getElementById("updResult");
    if (r && !/Asking GitHub/.test(r.textContent) && r.textContent.trim()) break;
    await new Promise(function(res){ setTimeout(res, 50); });
  }
  var panel = document.getElementById("updPanel");
  var open = panel.querySelector("#updOpen");
  return { text: document.getElementById("updResult").textContent, heads: [].map.call(panel.querySelectorAll(".updrelhead b"), function(b){ return b.textContent; }),
    imgs: panel.querySelectorAll("img").length, bolds: [].map.call(panel.querySelectorAll(".updrel b, .updrel code"), function(b){ return b.textContent; }),
    anchors: [].map.call(panel.querySelectorAll("a"), function(a){ return a.href; }), open: open && open.getAttribute("href"),
    later: !!panel.querySelector("#updLater"), pwned: !!window.__pwned, html: panel.innerHTML.length };
})()`;

const BOOTNOTES = `(function(){
  var KEY = Updates.SEEN_KEY, out = {};
  var run = function(seen, prefs){
    if (Updates.close) Updates.close();
    if (seen == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, seen);
    if (prefs) localStorage.setItem("wtss_prefs", "{}"); else localStorage.removeItem("wtss_prefs");
    var opened = Updates.bootNotes();
    var ov = document.getElementById("updOverlay");
    var r = { opened: opened, shown: !!ov, head: ov ? ov.querySelector(".updhead").textContent : "", stored: localStorage.getItem(KEY) };
    if (Updates.close) Updates.close();
    return r;
  };
  out.upgraded = run("1.0.0-beta.1", true);
  out.again = run(APP_VERSION, true);
  out.firstRun = run(null, false);
  out.fromOld = run(null, true);
  out.downgrade = run("9.0.0", true);
  document.getElementById("buildStamp").click();
  var ov = document.getElementById("updOverlay");
  out.onDemand = ov ? ov.querySelector(".updnotes") ? ov.querySelector(".updnotes").textContent : "(no notes)" : null;
  if (Updates.close) Updates.close();
  return out;
})()`;

const r = await evalInPage({ browser, timeoutMs: 120000, keep: argv.includes("--keep"),
  drive: async ({ cdp, evaluate }) => {
    const res = await evaluate(pageExpr(BODY));
    if (!res || res.__threw) return res;
    const seen = [];
    let mode = null;
    cdp.on((method, p) => {
      if (method !== "Fetch.requestPaused") return;
      seen.push({ url: p.request.url, method: p.request.method, headers: p.request.headers, mode });
      const answer = (code, body) => cdp.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: code,
        responseHeaders: [{ name: "Access-Control-Allow-Origin", value: "*" }, { name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(body)).toString("base64") }).catch(() => {});
      if (p.request.url !== API || mode === "offline") return cdp.send("Fetch.failRequest", { requestId: p.requestId, errorReason: "InternetDisconnected" }).catch(() => {});
      if (mode === "limited") return answer(403, { message: "API rate limit exceeded" });
      answer(200, FIXTURES[mode]);
    });
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    res.checks = {};
    for (const m of ["newer", "newest", "ahead", "limited", "offline", "notlist"]) {
      mode = m;
      const before = seen.length;
      res.checks[m] = await evaluate(CHECK);
      res.checks[m].requests = seen.slice(before);
    }
    res.boot = await evaluate(BOOTNOTES);
    const b = await evaluate(`({ errs: (window.__boot || {}).errs || [], rejs: (window.__boot || {}).rejs || [] })`);
    res.__errs = b.errs; res.__rejs = b.rejs;
    return res;
  } });
if (!r.ok) { console.log("FAILED to evaluate: " + JSON.stringify(r).slice(0, 400)); process.exit(1); }
const o = r.result;
if (o.__threw) { console.log("threw in page:\n" + o.__threw); process.exit(1); }

console.log("=== version order ===");
const want = ["<", "<", "<", "<", "<", "<", "<", "=", ">"];
const sign = v => v == null ? "null" : v < 0 ? "<" : v > 0 ? ">" : "=";
R.is(o.order.map(sign).join(" ") === want.join(" "),
  `beta.2 < beta.10 < 1.0.0, a pre-release below its release, numbers below words, v ignored (${o.order.map(sign).join(" ")})`);
R.is(o.bad === null, "a tag that is not a version compares as nothing");

console.log("=== nothing at boot ===");
R.is(o.bootRequests.length === 0, o.bootRequests.length ? "the boot asked the network: " + o.bootRequests.join(", ") : "the boot asked the network for nothing");
R.is(o.stamp.status === "v" + version && o.stamp.card.startsWith("v" + version + " · "),
  `the version is on the status bar (${o.stamp.status}) and the welcome card (${o.stamp.card})`);

console.log("=== Check ===");
const n = o.checks.newer;
R.is(n.requests.length === 1 && n.requests[0].url === API && n.requests[0].method === "GET",
  `one request, to the release list: ${n.requests.map(q => q.method + " " + q.url).join(", ")}`);
const hdr = Object.keys(n.requests[0] ? n.requests[0].headers : {}).map(h => h.toLowerCase());
R.is(!hdr.includes("cookie") && !hdr.includes("referer") && !hdr.includes("authorization"),
  `it carries no cookie, referrer or credentials (headers: ${hdr.join(", ")})`);
R.is(n.heads.join(" ") === "v1.0.0 v1.0.0-beta.10 v1.0.0-beta.9",
  `the newer builds, newest first, a draft and the older and equal ones left out: ${n.heads.join(" ")}`);
R.is(/notes of 1\.0\.0/.test(n.text) && /3\.4 MB/.test(n.text) && /2026-11-0/.test(n.text), "each with its notes, its size and its date");
R.is(n.imgs === 0 && !n.pwned && /<img src=x onerror=/.test(n.text) && /<b>tag<\/b>/.test(n.text),
  "markup in a release's notes is shown as text: no element made, nothing run");
R.is(n.bolds.includes("Bold") && n.bolds.includes("code"), "the notes' own **bold** and `code` are drawn");
R.is(!n.anchors.some(a => /evil\.example/.test(a)) && /a link/.test(n.text), "a link in the notes keeps its words and loses its address");
R.is(n.open === PAGE + "/tag/v1.0.0" && n.later, `Open the release page goes to the newest (${n.open}), and Not now is there`);
R.is(n.anchors.every(a => a.startsWith(PAGE)), "every address in the panel is the release page's");

console.log("=== the other answers ===");
const one = m => o.checks[m].requests.length === 1;
R.is(/You have the newest build/.test(o.checks.newest.text) && one("newest"), `newest: “${o.checks.newest.text}”`);
R.is(/newer than every release \(the newest is v0\.9\.0\)/.test(o.checks.ahead.text) && !o.checks.ahead.open, `ahead: “${o.checks.ahead.text}”, and nothing offered`);
R.is(/too many checks/.test(o.checks.limited.text) && o.checks.limited.open === PAGE, `rate-limited: one sentence and the release page`);
R.is(/Could not reach GitHub/.test(o.checks.offline.text) && o.checks.offline.open === PAGE && one("offline"), `offline: “${o.checks.offline.text}”`);
R.is(/did not answer as expected/.test(o.checks.notlist.text) && o.checks.notlist.open === PAGE, `an answer that is not a list: “${o.checks.notlist.text}”`);
R.is(Object.values(o.checks).every(c => c.requests.length === 1), "every check made exactly one request");

console.log("=== What's new ===");
const sec = (() => {
  const m = notesMd.split(/^## v/m).slice(1).find(s => s.split(/\s/)[0] === version);
  return m ? m.slice(m.indexOf("\n") + 1).trim() : null;
})();
R.is(o.embedded.replace(/^\n|\n$/g, "") === notesMd.replace(/\n$/, ""), `RELEASE_NOTES.md is embedded whole (${o.embedded.length} characters)`);
R.is(sec && o.own === sec, `this build's notes are its own section, v${version}`);
R.is(o.boot.upgraded.opened && /What's new in v/.test(o.boot.upgraded.head) && o.boot.upgraded.stored === version,
  `after a version change they show by themselves (“${o.boot.upgraded.head}”), and the version is remembered`);
R.is(!o.boot.again.opened && !o.boot.again.shown, "and only once");
R.is(!o.boot.firstRun.opened && o.boot.firstRun.stored === version, "a first run shows nothing");
R.is(o.boot.fromOld.opened, "an upgrade from a build before this one (settings, no seen version) shows them");
R.is(!o.boot.downgrade.opened, "a downgrade shows nothing");
R.is(o.boot.onDemand && sec && o.boot.onDemand.includes(sec.split("\n").find(l => l.trim()).replace(/[*`#-]/g, "").trim().slice(0, 30)),
  "and again from the panel");

const errs = (o.__errs || []).filter(e => !/net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
