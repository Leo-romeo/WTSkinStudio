// Assemble the product: src/ -> wt_skin_studio.html.
//
//   node tools/build.mjs            build once, with the project's own decoder   (npm run build)
//   node tools/build.mjs --check    build in memory and diff against the committed artifact,
//                                   exiting non-zero if they differ  (npm test, via t41)
//   node tools/build.mjs --watch    rebuild whenever anything under src/ changes  (npm run dev)
//   node tools/build.mjs --ooz --out dist/wt_skin_studio_ooz.html
//                                   a DIAGNOSTIC build carrying ooz (GPL-3) instead. It is the
//                                   reference the clean-room decoder was measured against, and
//                                   the oracle that repository's tools still read; linking it
//                                   makes the page GPL-3, so it is not the build you hand out
//                                   unless that is the licence you mean       (npm run build:ooz-page)
//   node tools/build.mjs --rad --out dist/wt_skin_studio_rad.html
//                                   a DIAGNOSTIC build carrying RAD's Oodle blob instead. Personal
//                                   use only, never redistributed, output git-ignored, and the
//                                   source blob is untracked — so this build is unavailable on a
//                                   fresh clone and everything still works    (npm run build:rad)
//   node tools/build.mjs --no-oodle NO decoder at all. Not a release configuration — it is the one
//                                   t42_nooodle.mjs runs, so that the honest-degradation path
//                                   stays exercised.
//   node tools/build.mjs --cdn --out dist/wt_skin_studio_cdn.html
//                                   the same page fetching three.js and JSZip from cdnjs, pinned
//                                   by SRI, instead of carrying them — how every build loaded them
//                                   until 2026-09-26, and the one-step way back if a release ever
//                                   wants the ~700 KB more than it wants to open offline. It needs
//                                   the network on first open, and its header says so (CDN_TEXT);
//                                   the only test that boots it is t31's control    (npm run build:cdn)
//
// THERE IS ONE BUILD, AND IT IS THE ONE YOU CAN GIVE AWAY. Since 2026-09-14 it carries the
// project's own decoder, `src/codecs/wtlz.js` — plain JavaScript, independently created in a
// separate repository whose log holds the experiment behind every format fact, and byte-exact
// against the reference on every compressed payload in the install (docs/WTLZ.md). Nothing in the
// shipped page is anyone else's decoder, which is what lets the project's licence be the owner's
// choice rather than one a dependency imposed (docs/LICENSING.md). The two decoders it replaced
// survive as diagnostics: ooz, the reference it was measured against, and RAD's, the reference ooz
// was measured against (docs/OODLE.md) — each one build flag, each one A/B you can still run after
// a game patch, and each carrying exactly one decoder so that an A/B compares decoders and not
// pages.
//
// It was ooz from 2026-08-25 to 2026-09-14, and RAD with `--public` swapping in ooz before that;
// the lesson of the first inversion still stands: the tracked artifact — the thing you
// double-click and the thing every test reads — must be the build that may leave the machine,
// or there are two products to keep in step for no benefit.
//
// WHY THIS AND NOT A BUNDLER. The page's `<script>` blocks share one global scope, and
// `pageSections()` reads their text back out of `document.scripts` at run time to build worker
// source (CLAUDE.md §3.1). Vite refuses to touch a non-module `<script src>` at all — it prints
// "can't be bundled without type=module" and emits an empty page — and giving them `type="module"`
// would put each file in its own scope, which is 870 cross-file bindings' worth of work that
// belongs to ROADMAP 2.3, not here. So the build is a concatenation, it has no dependencies, and
// `npm install` is not needed to produce the product. That also keeps CLAUDE.md §0.1 honest: the
// artifact is one file, and now so is the thing standing between the source and the artifact.
//
// THE ARTIFACT IS COMMITTED. `wt_skin_studio.html` stays in the repo and stays the thing you
// double-click; the build only regenerates it. Every offline test still reads it, unchanged.
// `--check` is what stops it drifting from src/ — it is a test, so an edit to the artifact that
// was never made in src/ fails the suite instead of being silently overwritten later.
//
// DEVELOPING. Open the built `wt_skin_studio.html` from disk, exactly as a user does, and run
// `npm run dev` in the background to rebuild on save. Do NOT open `src/index.html` directly: it
// loads fine (relative classic scripts work on file://) but every script there has a `src`, and
// `pageSections()` skips those — so the worker pools cannot find their sections and the app would
// behave differently from the thing you ship. Testing the artifact is the point.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "wt_skin_studio.html");

// `<script src="./codecs/dds.js"></script>` -> the file's text, inline, in its own <script> tag.
// One tag per source is required, not cosmetic: pageSections() reads each script's own text back
// out of `document.scripts`, so a marked section must be wholly inside one source (t41 checks it).
// Only relative sources are inlined; an absolute URL is left exactly as written, so a CDN tag with
// its SRI hash still means what it says.
const TAG = /<script src="(\.\/[^"]+)"><\/script>/g;

// Two tags in src/index.html are the decoder: `codecs/wtlz.js`, the decoder itself, and
// `vendor/oodle-b64.js`, the slot that declares which decoder the page carries (OODLE_IMPL) and
// holds a WASM blob if that decoder is one. Each build substitutes a real file into the slot rather
// than synthesising one — the substitute is where the reasoning lives, and the build stays a pure
// concatenation with nothing invented in it — and drops the tags it has no use for, so that every
// build carries exactly one decoder. `null` means "emit nothing for this tag".
//
//   (default)  wtlz, the project's own (docs/WTLZ.md). The slot declares it; no blob.
//   --ooz      ooz, GPL-3, byte-identical to RAD on every WT payload measured (docs/OODLE.md); the
//              reference wtlz was measured against. The WASM path in codecs/oodle.js serves it.
//   --rad      no substitution — the tag in src/index.html names the RAD blob directly. That file
//              is git-ignored and absent from a clone, so this build only exists where someone has
//              put it there deliberately; the build says so rather than emitting a broken page.
//              A distributable build cannot carry it (CLAUDE.md §0.2).
//   --no-oodle no decoder at all. Kept because "no Oodle" is still a configuration the app has to
//              handle honestly, and t42_nooodle.mjs is what keeps it honest.
const DECODER = "codecs/wtlz.js", SLOT = "vendor/oodle-b64.js";
const SUBS_WTLZ = { [SLOT]: "vendor/oodle-b64.wtlz.js" };
const SUBS_OOZ = { [SLOT]: "vendor/ooz-b64.js", [DECODER]: null };
const SUBS_RAD = { [DECODER]: null };
const SUBS_NO_OODLE = { [SLOT]: "vendor/oodle-b64.stub.js", [DECODER]: null };

// THE TWO LIBRARIES BY OTHER AUTHORS — three.js and JSZip — are inlined like every other source
// since 2026-09-26 (ROADMAP 4.50 (1)). Until then they were the only two things the page fetched,
// from cdnjs under Subresource Integrity, so a first open with no connection could not boot and
// every first open made a request to a third party — against CLAUDE.md §0.1's "offline, with no
// server and no network".
//
// This table is their provenance: the URL each copy was fetched from and the SRI hash it was checked
// against before anything touched it — the hashes the page's two CDN tags carried. t41_build.mjs
// re-hashes each copy in src/vendor/ on every `npm test`, so a copy cannot drift from its pin
// without the suite saying so. One copy is not byte-identical, and t41 knows why: JSZip holds eleven
// raw control characters (U+0001 to U+0007, in its ZIP signature strings, "PK\u0003\u0004" and
// five more), which the build refuses below, so the copy spells each one as its \u00XX escape. That
// is the same string to the engine, and t41 turns the escapes back into bytes before it hashes.
// Neither upstream file spelled a C0 escape of its own, which is what makes that reversal exact;
// a new version that does would fail the hash loudly, not pass it quietly.
//
// `--cdn` is the way back in one step: the same page, with these two tags pointing at cdnjs again,
// SRI hash and all, and the sentences that say where they come from rewritten (CDN_TEXT, below) —
// t41 proves the two pages differ in exactly those and nothing else. It is not the default, because
// the default is the page every test boots.
//
// `notices` are the copyright lines the page's header must carry for each copy, because the MIT
// licence each one comes under asks for its notice in every copy, and t41 holds the header to them.
// Two are the files' own headers. pako's is not in JSZip's file at all — its header names pako and
// links pako's LICENSE without quoting it — so the line is pako's LICENSE as Chromium's
// third-party notices reproduce it, read 2026-09-26 from the copy VS Code ships
// (LICENSES.chromium.html). Those notices also carry pako's older LICENSE, "Copyright (C) 2014-2016
// by Vitaly Puzrin"; the newer line is the one quoted, since it names both authors. Checked
// 2026-10-03 against pako 1.0.5's own LICENSE — the release JSZip's lockfile at v3.10.1 pins — and
// identical.
export const VENDORED = {
  "vendor/three-r128.min.js": {
    cdn: "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
    sri: "sha512-dLxUelApnYxpLt6K2iomGngnHO83iUvZytA3YjDUCjT0HDOHKXnVYdf3hU4JjM8uEhxf9nD1/ey98U3t2vZ0qQ==",
    notices: ["Copyright 2010-2021 Three.js Authors"],
  },
  "vendor/jszip-3.10.1.min.js": {
    cdn: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
    sri: "sha512-XMVd28F1oH/O71fzwBnV7HucLxVwtxf26XV8P4wPk26EDxuGZ91N8bsOttmnomcCD3CS5ZMRL50H0GgOHvegtg==",
    notices: ["(c) 2009-2016 Stuart Knightley <stuart [at] stuartk.com>",
      "Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn"],          // pako, inside JSZip
  },
};
// What `--cdn` puts in place of a vendored tag. `crossorigin` is required for SRI on a cross-origin
// script; cdnjs answers `Access-Control-Allow-Origin: *`, which is why this worked from a file://
// page on every open until 2026-09-26.
export const cdnTag = lib =>
  `<script src="${lib.cdn}" integrity="${lib.sri}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`;

// What `--cdn` says instead of what src/index.html says. The header tells whoever opens the page that
// it needs no network and carries both libraries, and the head comment that the build inlined them —
// each false on the page `--cdn` writes, which is the one the owner is told to release if a release
// wants the CDN (found in the review of 4.50 (1), 2026-09-26: that page inherited every word). Each
// `from` must occur exactly once in src/index.html, or `--cdn` refuses to build: a reworded header
// then fails `npm run build:cdn` and t41, rather than shipping the offline claim on a page that is
// not offline.
export const CDN_TEXT = [
  [`It needs no network either, not even the first time it is opened:
  everything it runs is in this file, both decompressors included, and so are two libraries by
  other authors, which it uses under the MIT licence:`,
  `It needs the network when it is opened, at least the first time:
  it is the page \`npm run build:cdn\` writes, which fetches two libraries by other authors from
  cdnjs, pinned by Subresource Integrity, instead of carrying them. Everything else it runs is in
  this file, both decompressors included. It uses the two libraries under the MIT licence:`],
  [`Each library's own notice heads its script below. The MIT licence, as it applies to all three:`,
   `Each library's own notice heads the file its tag below fetches. The MIT licence, as it applies
  to all three:`],
  [`<!-- three.js r128 and JSZip 3.10.1, inlined by the build like every other source since 2026-09-26
     (ROADMAP 4.50 (1)). Until then they were the only two things this file loaded from the`,
  `<!-- three.js r128 and JSZip 3.10.1 are FETCHED by this page, from cdnjs: it is the one
     \`npm run build:cdn\` writes. The page \`npm run build\` writes inlines them like every other
     source, since 2026-09-26 (ROADMAP 4.50 (1)).
     Until then they were the only two things any build of this file loaded from the`],
];
function cdnText(html) {
  for (const [from, to] of CDN_TEXT) {
    const n = html.split(from).length - 1;
    if (n !== 1) throw new Error(`--cdn: src/index.html says "${from.split("\n")[0].trim()}…" ${n} times, not once — ` +
      "reword tools/build.mjs's CDN_TEXT to match it, so the CDN page does not keep the offline page's words");
    html = html.replace(from, () => to);
  }
  return html;
}

// One source as the page carries it. Exported so a test that looks for a source's script in the page
// asks for this shape rather than spelling it a second time.
//
// THE `//# sourceURL` NAMES THE SCRIPT AFTER ITS FILE. Without it every script in the page was
// anonymous, and a stack trace pointed at a line of wt_skin_studio.html instead of at the module
// (docs/AGENT_ACCESS.md §11). Measured 2026-10-17 on Chrome 155: with it, error.stack, an
// ErrorEvent's filename and lineno, and the console's own "Uncaught" entry all name `src/<file>`,
// and count lines from the first line of the SCRIPT, not of the page. That is why the body follows
// `<script>` with no newline: with one there, every line number was the file's line plus one.
// The comment goes after the body, so it is outside every /*==NAME==*/ section, and what the pools
// and the tests lift is byte for byte what it was. It is a name and nothing else: the browser
// fetches nothing for it. A `sourceMappingURL` would make DevTools fetch a file, so none is ever
// written (t41 holds the page to all of this). In the decoder slot it names the file actually
// inlined, since that is the file its line numbers count.
export const inlineScript = (rel, body) => "<script>" + body + "\n//# sourceURL=src/" + rel + "\n</script>";

// RELEASE_NOTES.md, the one copy of what each build adds (ROADMAP 5.7), goes into the page at the
// comment `<!--==RELEASE_NOTES==-->` as a `<script type="text/plain" id="releaseNotes">`: text the
// browser neither runs nor fetches, which ui/updates.js reads for *What's new*, so the page needs no
// network to say what it adds. `publish.mjs` cuts the same file's section into the release's notes,
// and `.public` carries it so a public clone builds the same page. A tree without the file (the
// tests' fixture trees) embeds nothing; text that would end the tag is refused, as for a script.
export const NOTES_AT = "<!--==RELEASE_NOTES==-->";
function notesTag(root) {
  const file = path.join(root, "RELEASE_NOTES.md");
  const md = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\n$/, "") : "";
  if (/<\/script/i.test(md)) throw new Error('RELEASE_NOTES.md contains "</script>", which would end the tag early');
  return '<script type="text/plain" id="releaseNotes">\n' + md + "\n</script>";
}

// `root` is the repo root; it is a parameter only so the tests can build a fixture tree.
export function build(root = ROOT, opts = {}) {
  const subs = opts.noOodle ? SUBS_NO_OODLE : opts.rad ? SUBS_RAD : opts.ooz ? SUBS_OOZ : SUBS_WTLZ;
  const index = fs.readFileSync(path.join(root, "src", "index.html"), "utf8");
  const html = opts.cdn ? cdnText(index) : index;
  const used = [];
  let out = "", cur = 0, m;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(html))) {
    const tag = m[1].replace(/^\.\//, "");
    if (opts.cdn && VENDORED[tag]) {          // --cdn: this library comes from cdnjs, not from the page
      out += html.slice(cur, m.index) + cdnTag(VENDORED[tag]);
      cur = m.index + m[0].length;
      continue;
    }
    if (subs[tag] === null) {                 // this build has no use for the tag: not even an empty one
      out += html.slice(cur, m.index).replace(/\n[ \t]*$/, "");
      cur = m.index + m[0].length;
      continue;
    }
    const rel = subs[tag] || tag;
    const file = path.join(root, "src", rel);
    if (!fs.existsSync(file)) throw new Error(rel === "vendor/oodle-b64.js"
      ? "--rad needs src/vendor/oodle-b64.js, which is git-ignored and not in a clone. It is RAD's "
        + "blob, for your own install only (CLAUDE.md §0.2) — put your copy there, or drop --rad: "
        + "the default build carries the project's own decoder (codecs/wtlz.js) and decodes the same bytes."
      : rel === "vendor/ooz-b64.js"
      ? "--ooz needs src/vendor/ooz-b64.js, which the public repository does not carry. "
        + "It is ooz, a diagnostic kept on the author's machine; the default build carries the project's "
        + "own decoder (codecs/wtlz.js) and decodes the same bytes."
      : `src/index.html includes ${rel}, which does not exist`);
    const body = fs.readFileSync(file, "utf8").replace(/\r?\n$/, "");
    // An inline script ends at the first `</script>` in its text, wherever that is — inside a
    // string, inside a comment, anywhere. It would truncate the page silently.
    if (/<\/script/i.test(body)) throw new Error(`${rel} contains "</script>", which would end the tag early`);
    // A raw control byte is legal JS inside a string, and six sources had one as a key separator.
    // In the page it is an HTML parse error — the parser turns NUL into U+FFFD, so the page ran a
    // different string from the one Node tests lifted — and it made grep and git call the file
    // binary, which hid it from every search. Write it as its \u escape.
    const ctl = /[\x00-\x08\x0b\x0c\x0e-\x1f]/.exec(body);
    if (ctl) throw new Error(`${rel} line ${body.slice(0, ctl.index).split("\n").length} holds raw control character ` +
      `U+${ctl[0].charCodeAt(0).toString(16).padStart(4, "0")} — write it as "\\u${ctl[0].charCodeAt(0).toString(16).padStart(4, "0")}"`);
    out += html.slice(cur, m.index) + inlineScript(rel, body);
    cur = m.index + m[0].length;
    used.push(rel);
  }
  out += html.slice(cur);
  if (out.includes(NOTES_AT)) out = out.replace(NOTES_AT, () => notesTag(root));
  if (!used.length) throw new Error("src/index.html has no relative <script src> to inline — nothing to build");
  return { html: out, used };
}

const argv = process.argv.slice(2);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const OPTS = { noOodle: argv.includes("--no-oodle"), rad: argv.includes("--rad"), ooz: argv.includes("--ooz"),
  cdn: argv.includes("--cdn") };
if (OPTS.noOodle + OPTS.rad + OPTS.ooz > 1) { console.error("--ooz, --rad and --no-oodle are different builds; pick one"); process.exit(2); }
const DEST = argv.includes("--out") ? path.resolve(ROOT, argv[argv.indexOf("--out") + 1]) : OUT;
const name = path.relative(ROOT, DEST).replace(/\\/g, "/");

// Throws when the build does; each caller decides what a failure means. It used to exit the
// process itself, which made the `--watch` handler's catch dead code: the first save that left
// src/ unbuildable for a moment (a `<script src>` added before its file) killed the watcher.
function once(quiet) {
  const { html, used } = build(ROOT, OPTS);
  const prev = fs.existsSync(DEST) ? fs.readFileSync(DEST, "utf8") : null;
  if (prev === html) { if (!quiet) console.log(`${name} is already up to date (${used.length} sources)`); return false; }
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  fs.writeFileSync(DEST, html);
  console.log(`wrote ${name} — ${used.length} sources, ${(html.length / 1048576).toFixed(2)} MB` +
    (OPTS.rad ? "  ·  RAD BLOB — personal use only, never redistribute this file (CLAUDE.md §0.2)"
     : OPTS.ooz ? "  ·  ooz decoder (GPL-3) — a diagnostic; the page is GPL-3 with it in"
     : OPTS.noOodle ? "  ·  NO OODLE: no decoder at all"
     : "  ·  the project's own decoder — this one may be given to people") +
    (OPTS.cdn ? "  ·  three.js and JSZip from cdnjs — its first open needs the network" : ""));
  return true;
}

if (isMain) {
  if (argv.includes("--check")) {
    const { html } = build();
    const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (prev === html) { console.log("wt_skin_studio.html matches src/ exactly"); process.exit(0); }
    console.log("wt_skin_studio.html does NOT match src/ — run: npm run build");
    // Say where, so "which file did I edit by hand" is one line rather than a diff of 1.2 MB.
    let i = 0;
    while (i < Math.min(prev.length, html.length) && prev[i] === html[i]) i++;
    const line = html.slice(0, i).split("\n").length;
    console.log(`  first difference at built line ${line}:\n    built    ${JSON.stringify(html.slice(i, i + 90))}\n    committed ${JSON.stringify(prev.slice(i, i + 90))}`);
    process.exit(1);
  } else if (argv.includes("--watch")) {
    try { once(false); } catch (e) { console.error("  build failed: " + e.message); }
    console.log("watching src/ — Ctrl+C to stop");
    let timer = null;
    const rebuild = (_ev, file) => {
      clearTimeout(timer);                       // an editor's save is several events; coalesce them
      timer = setTimeout(() => {
        try { if (once(true)) console.log("  " + new Date().toLocaleTimeString() + "  " + file); }
        catch (e) { console.error("  build failed: " + e.message); }
      }, 80);
    };
    fs.watch(path.join(ROOT, "src"), { recursive: true }, rebuild);
    fs.watch(ROOT, (ev, file) => { if (file === "RELEASE_NOTES.md") rebuild(ev, file); });   // embedded too
  } else {
    // A missing RAD blob is an expected state, not a crash: it is git-ignored, so it is simply not
    // there on a clone. Say the sentence and stop, rather than printing a stack for a condition the
    // build already knows how to explain.
    try { once(false); } catch (e) { console.error(e.message); process.exit(2); }
  }
}
