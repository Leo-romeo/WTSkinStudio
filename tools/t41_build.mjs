// The committed artifact must be exactly what src/ builds (ROADMAP 2.1).
//
// `wt_skin_studio.html` is the product and stays in the repo — that is what a user double-clicks
// and what every other test in this suite reads. Now that it is generated, the failure mode to
// guard is drift: someone edits the 16 852-line artifact directly, the change works, and the next
// `npm run build` silently reverts it. So the build runs here and the result is compared, which
// turns "you edited the wrong file" into a failing test with a line number instead of lost work.
//
// Since 2026-09-26 (ROADMAP 4.50 (1)) it also holds the page to needing no network — no tag
// attribute, CSS url() or @import, or refresh in it names an address off this machine — holds the
// two vendored libraries to the bytes their SRI pins name, and holds the header to their notices.
// What this cannot see is an address a script builds while it runs; `t31_boot` is that half: it
// boots the page with the network off and logs every request the page and its workers make.
//
// The rest is the assembler's own guardrails, on fixture trees rather than on the real page.
//
// Usage: node tools/t41_build.mjs
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { build, VENDORED, cdnTag, CDN_TEXT, inlineScript } from "./build.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.log("  FAIL " + m); } };
const threw = fn => { try { fn(); return null; } catch (e) { return e.message; } };

console.log("=== the artifact is what src/ builds ===");
const built = build().html;
const committed = fs.readFileSync(path.join(ROOT, "wt_skin_studio.html"), "utf8");
if (built === committed) ok(true, `wt_skin_studio.html matches src/ exactly (${(built.length / 1048576).toFixed(2)} MB)`);
else {
  let i = 0;
  while (i < Math.min(built.length, committed.length) && built[i] === committed[i]) i++;
  ok(false, `wt_skin_studio.html has drifted from src/ — run npm run build\n` +
    `         first difference at built line ${built.slice(0, i).split("\n").length}\n` +
    `         built     ${JSON.stringify(built.slice(i, i + 80))}\n` +
    `         committed ${JSON.stringify(committed.slice(i, i + 80))}`);
}

// The sources are load-order dependent classic scripts sharing one global scope, so the assembler
// must preserve order and must not merge them into one tag: pageSections() reads each script's own
// text back at run time (CLAUDE.md §3.1), and a section that spanned two tags would be lifted with
// the `</script><script>` between it. Counted with check.mjs's regex rather than by counting
// `<script>` — the page's own comments mention the tag, and only the parse that treats
// opener-to-first-closer as one block agrees with what a browser does.
const sources = build().used;
// RELEASE_NOTES.md's tag (ROADMAP 5.7) is text, not a source: the one script of type text/plain.
const notesTags = (built.match(/<script type="text\/plain" id="releaseNotes">/g) || []).length;
ok(notesTags === 1 && !built.includes("<!--==RELEASE_NOTES==-->"),
  `RELEASE_NOTES.md is embedded once, where src/index.html's marker was, as text the page neither runs nor fetches (${notesTags})`);
const inline = (built.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi) || [])
  .filter(t => !t.startsWith('<script type="text/plain" id="releaseNotes">'));
ok(inline.length === sources.length, `every source is its own inline <script> tag → ${inline.length} tags, ${sources.length} sources`);
ok(sources.length > 5, `the codecs layer is split into modules, not one block → ${sources.length} sources`);
ok(/\/\*==DDS==\*\//.test(built) && /\/\*==ENDDDS==\*\//.test(built),
  "section markers survive the build — the worker pools lift their source from them");

// Every marked section must live inside ONE tag. This is the invariant the module split has to
// keep: the pools and every offline test slice a section out of the page by its markers, so a
// section straddling a tag boundary would hand a worker literal markup.
const straddled = [];
for (const m of built.matchAll(/\/\*==([A-Z0-9]+)==\*\/$/gm)) {
  if (m[1].startsWith("END")) continue;
  const end = built.indexOf(`/*==END${m[1]}==*/`, m.index);
  if (end < 0) continue;                                   // a prose mention, not a section
  if (built.slice(m.index, end).includes("</script>")) straddled.push(m[1]);
}
ok(straddled.length === 0, straddled.length
  ? `sections spanning a <script> boundary: ${straddled.join(", ")} — a module may not split a section`
  : "no section spans a <script> boundary — each marked section is wholly inside one module");

const iC = built.indexOf("const DDS_MAGIC"), iE = built.indexOf("const $ = id =>"), iX = built.indexOf("function expOpt");
ok(iC > 0 && iC < iE && iE < iX, "and the sources are in load order: codecs, editor, export");
// Layer order, not just file order: a codec must not be able to see a format's parser, and the
// only thing enforcing that in a shared global scope is which script ran first.
const order = ["const DDS_MAGIC", "function decodeBCn", "function encodeBC3", "function parseOBJ",
  "function zstdDec", "function loadDataBlock", "function readVromfs", "function unitNormalize",
  "const AcesDB", "function grpParseFront", "function parseA2D", "function parseTGA"];
const at = order.map(s => built.indexOf(s));
ok(at.every(i => i > 0) && at.every((v, i) => i === 0 || v > at[i - 1]),
  "the bottom layers load in dependency order: dds → bcn → obj → zstd → blk → vromfs → registry → aces → model → a2d → tga");

console.log("\n=== every script is named after its src/ file ===");
// A stack trace, an ErrorEvent and the console's "Uncaught" entry name a script by its
// `//# sourceURL`, and count its lines from the script's own first line (build.mjs's inlineScript
// has the measurement). So each source must be in the page exactly as inlineScript lays it out:
// its first line straight after `<script>`, since a newline there put every reported line one past
// the file's, and the comment after its last line.
const bodyOf = rel => fs.readFileSync(path.join(ROOT, "src", rel), "utf8").replace(/\r?\n$/, "");
const misplaced = sources.filter(rel => !built.includes(inlineScript(rel, bodyOf(rel))));
ok(misplaced.length === 0, misplaced.length ? `not in the page as inlineScript lays it out: ${misplaced.join(", ")}`
  : `all ${sources.length} sources are in the page whole, from the first character after <script>, each followed by its //# sourceURL`);
const named = [...built.matchAll(/^\/\/# sourceURL=(.*)$/gm)].map(m => m[1]);
ok(named.length === sources.length && named.every((u, i) => u === "src/" + sources[i]),
  `one //# sourceURL per script, naming its own file, in load order (${named.length} for ${sources.length} sources)`);
// What the pools and the tests lift must be byte for byte what it was: pageSections()'s own rule —
// the longest complete body under each name, a prose mention never shadowing a section — run over
// the page's scripts and over the source files gives the same sections.
const sectionsOf = texts => {
  const found = new Map();
  for (const t of texts) {
    const re = /\/\*==([A-Z0-9]+)==\*\//g;
    let x;
    while ((x = re.exec(t))) {
      if (x[1].startsWith("END")) continue;
      const end = t.indexOf("/*==END" + x[1] + "==*/", x.index);
      if (end < 0) continue;
      const body = t.slice(x.index + x[0].length, end);
      if (!found.has(x[1]) || found.get(x[1]).length < body.length) found.set(x[1], body);
    }
  }
  return found;
};
const liftedFromPage = sectionsOf(inline.map(s => s.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "")));
const liftedFromFiles = sectionsOf(sources.map(bodyOf));
const notTheFile = [...new Set([...liftedFromPage.keys(), ...liftedFromFiles.keys()])]
  .filter(n => liftedFromPage.get(n) !== liftedFromFiles.get(n));
ok(notTheFile.length === 0 && liftedFromPage.size > 10, notTheFile.length
  ? `section(s) lifted from the page differ from their files: ${notTheFile.join(", ")}`
  : `all ${liftedFromPage.size} sections lifted from the page are their files' sections, byte for byte — no //# sourceURL inside one`);
const planted = sectionsOf(inline.map(s => s.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "")
  .replace("/*==ENDDDS==*/", () => "//# sourceURL=src/codecs/dds.js\n/*==ENDDDS==*/")));
ok(planted.get("DDS") !== liftedFromFiles.get("DDS"), "and that comparison can fail: a //# sourceURL planted inside DDS's section is a different lift");
ok(!/sourceMappingURL/.test(built), "and the page names no sourceMappingURL, which would make DevTools fetch a file");

console.log("\n=== the page needs no network, and carries the libraries it was pinned to ===");
// CLAUDE.md §0.1 promises a page that opens "offline, with no server and no network". What breaks
// that statically is anything in the page that names an address off this machine and loads it: a
// <script src="http…"> above all — the build leaves one exactly as written, which is how the two
// cdnjs tags lived in this page until 4.50 (1) — and any other attribute that fetches, and CSS,
// which fetches through url() and @import from a <style>, a style="" or a string a script assigns.
// The first version of this check read only src/href on eight tags, and the review of 4.50 (1) got
// a stylesheet @import past it (2026-09-26); this is the widened one, with every form it knows proved
// below. `//x` counts too: a file:// page resolves it to a UNC path, which is a network share.
// Measured the same day, the only absolute URLs in the committed page are licence links in comments,
// the XHTML and SVG namespaces handed to createElementNS, and a documentation link in one of JSZip's
// error messages — none of them a load, and none of them matched. An address a script assembles
// while it runs is out of reach here; t31_boot logs those, from the page and from its workers.
const NET = String.raw`(?:(?:https?|wss?|ftp):)?\/\/`;
const LOADS = "src|href|poster|data|action|formaction|background|manifest|ping|xlink:href|lowsrc|codebase";
const external = page => {
  const found = [];
  // an attribute that fetches, on any element — except a link's href, which navigates only when clicked
  for (const m of page.matchAll(new RegExp(String.raw`<([a-zA-Z][\w:-]*)\b[^<>]*?\s(${LOADS})\s*=\s*["']?\s*(${NET}[^"'\s>]*)`, "gi")))
    if (!(/^(a|area)$/i.test(m[1]) && /^href$/i.test(m[2]))) found.push(`<${m[1].toLowerCase()} ${m[2].toLowerCase()}> ${m[3]}`);
  // srcset is a list, and the candidate that leaves the machine need not be the first
  for (const m of page.matchAll(/<([a-zA-Z][\w:-]*)\b[^<>]*?\s((?:image)?srcset)\s*=\s*(["'])([^"']*)\3/gi))
    for (const c of m[4].split(","))
      if (new RegExp("^\\s*" + NET, "i").test(c)) found.push(`<${m[1].toLowerCase()} ${m[2].toLowerCase()}> ${c.trim().split(/\s+/)[0]}`);
  // CSS, wherever it sits. Not `createObjectURL(` or `new URL(`, which are script, not stylesheet.
  for (const m of page.matchAll(new RegExp(String.raw`(?<![\w$.])(?<!\bnew\s+)url\(\s*["']?\s*(${NET}[^"')\s]*)`, "gi")))
    found.push(`css url() ${m[1]}`);
  for (const m of page.matchAll(new RegExp(String.raw`@import\s+["']\s*(${NET}[^"'\s]*)`, "gi")))
    found.push(`css @import ${m[1]}`);
  // a refresh that sends the page somewhere else
  for (const m of page.matchAll(new RegExp(String.raw`<meta\b[^>]*?\bhttp-equiv\s*=\s*["']?refresh[^>]*?\burl\s*=\s*(${NET}[^"'\s>;]*)`, "gi")))
    found.push(`<meta refresh> ${m[1]}`);
  return found;
};

// The check against every form it claims to catch, each on its own, and against what it must leave
// alone — so "catches a CSS load" is a result on every run rather than a sentence in a comment.
const MUST = {
  "the review's @import": `<style>@import url("https://127.0.0.1:9/probe.css");</style>`,
  "an @import without url()": `<style>@import 'https://x.test/a.css';</style>`,
  "a web font": `<style>@font-face{font-family:f;src:url(https://x.test/f.woff2)}</style>`,
  "a style attribute": `<div style="background:url('//x.test/b.png')"></div>`,
  "CSS a script assigns": `<script>el.style.backgroundImage = "url(https://x.test/c.png)";</script>`,
  "a stylesheet link": `<link rel="stylesheet" href="https://x.test/s.css">`,
  "an unquoted script src": `<script src=https://x.test/a.js></script>`,
  "an iframe": `<iframe src="https://x.test/"></iframe>`,
  "a srcset's second candidate": `<img srcset="a.png 1x, https://x.test/b.png 2x">`,
  "a poster": `<video poster="https://x.test/p.jpg"></video>`,
  "an object": `<object data="//x.test/o.svg"></object>`,
  "a form's action": `<form action="https://x.test/post"></form>`,
  "an SVG image": `<svg><image xlink:href="https://x.test/i.png"/></svg>`,
  "a base": `<base href="https://x.test/">`,
  "a refresh": `<meta http-equiv="refresh" content="0; url=https://x.test/">`,
};
const missed = Object.entries(MUST).filter(([, html]) => external(html).length !== 1).map(([what, html]) => `${what} (${external(html).length})`);
ok(missed.length === 0, missed.length ? `the check does not name exactly one load in: ${missed.join("; ")}`
  : `the check names the one load in each of ${Object.keys(MUST).length} forms: ${Object.keys(MUST).join(", ")}`);
const LEAVE = `<!-- See <https://www.gnu.org/licenses/> --><a href="https://github.com/nodeca/pako">pako</a>
<script>document.createElementNS("http://www.w3.org/2000/svg", "svg"); URL.createObjectURL(b); new URL("https://x.test/");
throw new Error("see https://stuk.github.io/jszip/documentation/howto/read_zip.html");</script>
<style>.a{background:url(data:image/png;base64,AAAA)}.b{background:url(./x.png)}.c{fill:url(#grad)}</style>
<img src="data:image/png;base64,AAAA"><img src="./local.png"><div data-url="https://x.test/">`;
ok(external(LEAVE).length === 0, external(LEAVE).length ? `the check names things that load nothing: ${external(LEAVE).join(", ")}`
  : "and names nothing in a link, a comment, a namespace, an error message, a data:/relative/#fragment url() or a data- attribute");

const leaks = external(committed);
ok(leaks.length === 0, leaks.length ? `the page reaches for the network: ${leaks.join(", ")}`
  : "the page names no address off this machine to load: no fetching attribute, CSS url() or @import, or refresh");
const srcTags = committed.match(/<script\b[^>]*\bsrc\s*=/gi) || [];
ok(srcTags.length === 0, srcTags.length ? `${srcTags.length} <script src> tag(s) survived the build: ${srcTags.join(" | ")}`
  : "and no <script> has a src at all — every one is inline, which is what a double-clicked file needs");

// The same check against the page `--cdn` writes, which must FAIL it: that is the proof on the real
// page that the check can fail, kept here rather than done once by hand. That page must also be this
// one in every byte but its two library tags and the sentences CDN_TEXT rewrites, which is what lets
// `--cdn` be the one-step way back to the CDN without being a second product to keep in step — and
// the rewrite is what stops it telling whoever opens it that it needs no network (the review of
// 4.50 (1) found it saying exactly that, word for word from this page).
let cdnPage = "";
const cdnRefused = threw(() => { cdnPage = build(ROOT, { cdn: true }).html; });
ok(!cdnRefused, cdnRefused ? "npm run build:cdn refuses to build: " + cdnRefused : "npm run build:cdn builds");
const cdnLeaks = external(cdnPage);
ok(cdnLeaks.length === 2 && cdnLeaks.every(l => l.startsWith("<script src> https://cdnjs.cloudflare.com/")),
  `the check can fail: on the page --cdn writes it names ${cdnLeaks.length} — ${cdnLeaks.join(", ")}`);
let expectCdn = built;
for (const [rel, lib] of Object.entries(VENDORED)) {
  const body = fs.readFileSync(path.join(ROOT, "src", rel), "utf8").replace(/\r?\n$/, "");
  expectCdn = expectCdn.replace(inlineScript(rel, body), () => cdnTag(lib));  // a function: `body` is full of `$`
}
const onceEach = CDN_TEXT.map(([from]) => built.split(from).length - 1);
for (const [from, to] of CDN_TEXT) expectCdn = expectCdn.replace(from, () => to);
ok(onceEach.every(n => n === 1) && expectCdn === cdnPage,
  "the --cdn page is this page with its two library tags pointed at cdnjs and CDN_TEXT's " +
  `${CDN_TEXT.length} sentences rewritten, and differs in nothing else` + (onceEach.every(n => n === 1) ? "" : ` (each sentence found ${onceEach.join(", ")} times)`));
ok(CDN_TEXT.every(([from, to]) => !cdnPage.includes(from) && cdnPage.includes(to)) && /It needs the network when it is opened/.test(cdnPage),
  "and that page says it needs the network, and nothing in it says it does not or that the build inlined the libraries");

// The notices. Each copy comes under MIT, which asks for its copyright notice in every copy, and a
// user is only ever handed the page, so the page's own header carries them — pako's included,
// which sits inside JSZip and whose line JSZip's file does not quote (the review of 4.50 (1) found
// it nowhere in the page). build.mjs's VENDORED says where each line was read.
const head = committed.slice(0, committed.search(/<html\b/i));
const notices = Object.values(VENDORED).flatMap(l => l.notices);
const unsaid = notices.filter(n => !head.includes(n));
ok(unsaid.length === 0, unsaid.length ? `the page's header lacks: ${unsaid.join(" | ")}`
  : `the page's header carries the notice of every library inside it — ${notices.length}: ${notices.join(" · ")}`);
const ownHeads = Object.entries(VENDORED).filter(([rel, lib]) =>
  !fs.readFileSync(path.join(ROOT, "src", rel), "utf8").slice(0, 600).includes(lib.notices[0])).map(([rel]) => rel);
ok(ownHeads.length === 0, ownHeads.length ? `a vendored file's head does not state the notice VENDORED gives it: ${ownHeads.join(", ")}`
  : "and each library's first notice is the one its own file states at its head");

// Each vendored copy is the file its SRI hash pinned — the hash the CDN tag carried and the browser
// checked on every open, now checked here instead. JSZip's copy spells its eleven raw control
// characters as \u00XX escapes (tools/build.mjs says why), so every C0 escape is turned back into
// its byte before hashing; three.js's copy has none and is hashed as it stands.
const indexHtml = fs.readFileSync(path.join(ROOT, "src", "index.html"), "utf8");
const libTags = [...indexHtml.matchAll(/<script src="\.\/(vendor\/[^"]+\.min\.js)"><\/script>/g)].map(m => m[1]);
ok(libTags.length === Object.keys(VENDORED).length && libTags.every(t => VENDORED[t]),
  `every library tag in src/index.html has a pin in build.mjs's VENDORED, and every pin a tag (${libTags.join(", ")})`);
for (const [rel, lib] of Object.entries(VENDORED)) {
  let respelled = 0;
  const upstream = Buffer.from(fs.readFileSync(path.join(ROOT, "src", rel), "latin1")
    .replace(/\\u00([01][0-9a-fA-F])/g, (_, h) => { respelled++; return String.fromCharCode(parseInt(h, 16)); }), "latin1");
  const sri = "sha512-" + crypto.createHash("sha512").update(upstream).digest("base64");
  ok(sri === lib.sri, sri === lib.sri
    ? `${rel} is ${lib.cdn.replace("https://cdnjs.cloudflare.com/ajax/libs/", "cdnjs's ")} under its SRI pin` +
      (respelled ? ` (${respelled} control characters spelled as escapes, turned back to hash)` : ", byte for byte")
    : `${rel} is NOT the pinned file: sha512 ${sri}, pin ${lib.sri}`);
}

console.log("\n=== the assembler's guardrails ===");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wtbuild-"));
const mk = (html, files) => {
  const d = fs.mkdtempSync(path.join(dir, "t-"));
  fs.mkdirSync(path.join(d, "src", "app"), { recursive: true });
  fs.writeFileSync(path.join(d, "src", "index.html"), html);
  for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(d, "src", n), b);
  return d;
};

const good = mk(`<body><script src="./app/a.js"></script><script src="./app/b.js"></script></body>`,
  { "app/a.js": "var a = 1;", "app/b.js": "var b = a + 1;" });
const r = build(good);
ok(r.html === `<body><script>var a = 1;\n//# sourceURL=src/app/a.js\n</script><script>var b = a + 1;\n//# sourceURL=src/app/b.js\n</script></body>`,
  "a relative <script src> is replaced by the file's text, in place and in order, each named after its file");

// `$&` and `$1` in a source would be eaten by String.replace with a string replacement. Every
// regex in this codebase is a source that contains them, so this is not hypothetical — it is the
// bug the first version of the splitter had.
const dollars = mk(`<body><script src="./app/a.js"></script></body>`,
  { "app/a.js": `var re = /^gear_l\\d*$/, s = "$&$1$$";` });
ok(build(dollars).html.includes(`/^gear_l\\d*$/, s = "$&$1$$"`),
  "a source containing $& / $1 is inlined verbatim, not substituted");

const missing = mk(`<body><script src="./app/gone.js"></script></body>`, {});
ok(/does not exist/.test(threw(() => build(missing)) || ""),
  "an include that does not exist is refused, not skipped");

// The first `</script>` anywhere in the text ends the tag, string literal or not, and the rest of
// the page becomes markup. Silent truncation of a 1.2 MB file is not something to discover later.
const closer = mk(`<body><script src="./app/a.js"></script></body>`,
  { "app/a.js": `var s = "</script>";` });
ok(/would end the tag early/.test(threw(() => build(closer)) || ""),
  "a source containing </script> is refused — it would truncate the page");

const absolute = mk(`<body><script src="https://cdn/three.js" integrity="sha512-x"></script><script src="./app/a.js"></script></body>`,
  { "app/a.js": "var a = 1;" });
ok(build(absolute).html.includes(`<script src="https://cdn/three.js" integrity="sha512-x">`),
  "an absolute URL is left exactly as written, SRI hash and all");

const empty = mk(`<body>nothing here</body>`, {});
ok(/no relative <script src>/.test(threw(() => build(empty)) || ""),
  "a page with nothing to inline is an error, not an empty build");

// The app tells the user which build it is, on the welcome card. That is only useful if it is
// true, and `APP_VERSION` is a hand-written constant precisely so the build can stay a pure
// concatenation with nothing substituted into it — so something has to hold the two together.
const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const declared = /const APP_VERSION = "([^"]+)";/.exec(fs.readFileSync(path.join(ROOT, "src", "core", "version.js"), "utf8"));
ok(declared && declared[1] === pkgVersion,
  `src/core/version.js says ${declared ? declared[1] : "(nothing)"} and package.json says ${pkgVersion}`);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
