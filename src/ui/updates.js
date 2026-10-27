"use strict";
// ---- Check for updates, and What's new (ROADMAP 5.7, asked for by the owner 2026-10-23) ----
// The version on the welcome card and in the status bar opens one small panel: this build, what it
// adds, and *Check for updates*. Steps 1, 2 and 4 of 5.7; step 3, taking the new build in place, is
// deferred by the owner (2026-10-23), so nothing here downloads a page, writes a file or opens a
// window — the way to a newer build is its release page.
//
// THE ONE REQUEST THE APP MAKES. CLAUDE.md §0.1 says nothing leaves the machine; the owner's reversal
// of FUNDING.md §5's "no update check" (2026-10-23) is this shape and no wider: nothing is asked
// unless the user clicks *Check*, the request carries nothing of theirs (no credentials, no referrer,
// no query, no header that is not CORS-safelisted), and the page still boots and works with the
// network off (t31). Two fixed addresses and no others — the API's release list and the releases
// page — and a release's own `html_url` is used only when it is under the second.
//
// Measured 2026-10-23 from a page opened from disk (`Origin: null`): the release list answers with
// `Access-Control-Allow-Origin: *`, 60 unauthenticated requests an hour per address, and each release
// carries its notes as Markdown. Those notes arrive over the network, so they are drawn as elements
// with text in them (`Updates.md`), never as markup: a `<b>` in a release body is shown as `<b>`.
//
// The notes of THIS build are embedded at build time from RELEASE_NOTES.md (tools/build.mjs,
// a text/plain script with the id releaseNotes), so *What's new* needs no network. They show once
// by themselves after the version changes (`bootNotes`) and again whenever the panel is opened.
// tools/t170_updates.mjs holds all of it; t44's "updates-panel" case holds the panel's markup.
const Updates = {
  API: "https://api.github.com/repos/Leo-romeo/WTSkinStudio/releases",
  PAGE: "https://github.com/Leo-romeo/WTSkinStudio/releases",
  SEEN_KEY: "wtss_seenVersion",         // the last version this browser opened, for bootNotes
  TIMEOUT_MS: 15000,
  busy: false,
  close: null,                          // closes the open panel, or null

  // ---- version order: semver's, so beta.2 < beta.10 < 1.0.0 ----
  parse(v){
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v || "").trim());
    return m ? { core: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split(".") : [] } : null;
  },
  // < 0, 0, > 0; null when either is not a version. A pre-release is below its release; its
  // identifiers compare numerically when both are numbers, a number below a word, else as text.
  cmp(a, b){
    const x = Updates.parse(a), y = Updates.parse(b);
    if (!x || !y) return null;
    for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
    if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
    for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
      const p = x.pre[i], q = y.pre[i], pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
      if (p === q) continue;
      if (pn && qn) return +p - +q;
      if (pn !== qn) return pn ? -1 : 1;
      return p < q ? -1 : 1;
    }
    return x.pre.length - y.pre.length;
  },

  // ---- the embedded notes ----
  // RELEASE_NOTES.md as embedded, cut at its `## v<version>` lines: [{ ver, body }], file order.
  sections(md){
    const out = [];
    let cur = null;
    for (const line of String(md || "").split("\n")) {
      const h = /^## v(\S+)/.exec(line);
      if (h) { cur = { ver: h[1], lines: [] }; out.push(cur); }
      else if (cur) cur.lines.push(line);
    }
    return out.map(s => ({ ver: s.ver, body: s.lines.join("\n").trim() }));
  },
  embedded(){ const el = document.getElementById("releaseNotes"); return el ? el.textContent : ""; },
  ownNotes(){
    const s = Updates.sections(Updates.embedded()).find(x => Updates.cmp(x.ver, APP_VERSION) === 0);
    return s && s.body ? s.body : null;
  },

  // ---- Markdown, as elements ----
  // The few shapes the notes use: `###` headings, `-` lists (a list item continues on an indented
  // line), paragraphs, and **bold**, *italic*, `code` inside them. A link keeps its words and drops
  // its address, so nothing in a release body can put an address in the page. Every piece of text
  // goes in through textContent: what is not one of these shapes is shown as it was written.
  md(text){
    const root = document.createElement("div");
    root.className = "updnotes";
    const inline = (into, s) => {
      for (const part of s.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]*\))/)) {
        if (!part) continue;
        let el = null, t = part;
        if (/^\*\*.+\*\*$/.test(part)) { el = "b"; t = part.slice(2, -2); }
        else if (/^\*.+\*$/.test(part)) { el = "i"; t = part.slice(1, -1); }
        else if (/^`.+`$/.test(part)) { el = "code"; t = part.slice(1, -1); }
        else if (/^\[.+\]\(.*\)$/.test(part)) t = part.slice(1, part.indexOf("]("));
        if (el) { const e = document.createElement(el); e.textContent = t; into.appendChild(e); }
        else into.appendChild(document.createTextNode(t));
      }
    };
    let para = null, list = null, item = null;
    const flush = () => { if (para) inline(para.el, para.text.join(" ")); para = null; };
    const endItem = () => { if (item) inline(item.el, item.text.join(" ")); item = null; };
    for (const raw of String(text || "").replace(/\r\n/g, "\n").split("\n")) {
      const line = raw.replace(/\s+$/, "");
      if (!line.trim()) { flush(); endItem(); list = null; continue; }
      const h = /^#{1,6}\s+(.*)$/.exec(line);
      const li = /^\s*[-*]\s+(.*)$/.exec(line);
      if (h) { flush(); endItem(); list = null; const e = document.createElement("h4"); inline(e, h[1]); root.appendChild(e); }
      else if (li) {
        flush(); endItem();
        if (!list) { list = document.createElement("ul"); root.appendChild(list); }
        item = { el: document.createElement("li"), text: [li[1]] }; list.appendChild(item.el);
      } else if (item && /^\s/.test(raw)) item.text.push(line.trim());
      else {
        endItem(); list = null;
        if (!para) { para = { el: document.createElement("p"), text: [] }; root.appendChild(para.el); }
        para.text.push(line.trim());
      }
    }
    flush(); endItem();
    return root;
  },

  // ---- the check ----
  // One request. What comes back is reduced to { kind, ... } here, so the panel draws from data and
  // t44 can draw every outcome without a network.
  async check(){
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), Updates.TIMEOUT_MS);
    let res;
    try {
      res = await fetch(Updates.API, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store",
        mode: "cors", signal: ctl.signal, headers: { Accept: "application/vnd.github+json" } });
    } catch (e) {
      // A refused or absent connection is the answer "offline", not a fault to report: the panel says it.
      return { kind: "offline", why: e && e.name === "AbortError" ? "timeout" : "network" };
    } finally { clearTimeout(timer); }
    if (res.status === 403 || res.status === 429) return { kind: "limited" };
    if (!res.ok) return { kind: "down", status: res.status };
    let list;
    try { list = await res.json(); } catch (e) { return { kind: "down", status: res.status, why: "not JSON" }; }
    if (!Array.isArray(list)) return { kind: "down", status: res.status, why: "not a list" };
    return Updates.judge(list, APP_VERSION);
  },
  // The release list against this build: newer ones newest first, else newest / ahead / none.
  judge(list, mine){
    const rels = list.filter(r => r && !r.draft && Updates.parse(r.tag_name)).map(r => {
      const asset = (r.assets || []).find(a => a && a.name === "wt_skin_studio.html");
      const page = typeof r.html_url === "string" && r.html_url.startsWith(Updates.PAGE + "/") ? r.html_url : Updates.PAGE;
      return { ver: String(r.tag_name).replace(/^v/, ""), name: String(r.name || r.tag_name),
        date: typeof r.published_at === "string" ? r.published_at.slice(0, 10) : "",
        size: asset && +asset.size > 0 ? +asset.size : 0, notes: typeof r.body === "string" ? r.body : "", page };
    }).sort((a, b) => Updates.cmp(b.ver, a.ver));
    const newer = rels.filter(r => Updates.cmp(r.ver, mine) > 0);
    if (newer.length) return { kind: "newer", newer };
    if (!rels.length) return { kind: "none" };
    if (rels.some(r => Updates.cmp(r.ver, mine) === 0)) return { kind: "newest" };
    return { kind: "ahead", newest: rels[0].ver };
  },

  // ---- the panel ----
  // state: { whatsNew: true } opens on this build's notes (after an update); { result } shows a
  // check's outcome; { checking } the moment between. Built as elements, pure of the network.
  link(text, href){
    const a = document.createElement("a");
    a.textContent = text; a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
    return a;
  },
  panel(state){
    state = state || {};
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const box = el("div", "updpanel"); box.id = "updPanel";
    box.appendChild(el("h3", null, "WT Skin Studio"));
    box.appendChild(el("div", "hint", "This build: " + appBuildLabel()));
    const own = Updates.ownNotes();
    box.appendChild(el("h4", "updhead", (state.whatsNew ? "What's new in v" : "What's new in this build, v") + APP_VERSION));
    box.appendChild(own ? Updates.md(own) : el("p", "hint", "No notes are embedded for this build."));
    const out = el("div", "updresult"); out.id = "updResult";
    const r = state.result;
    if (state.checking) out.appendChild(el("p", "hint", "Asking GitHub for the list of releases…"));
    else if (r && r.kind === "newer") {
      out.appendChild(el("h4", "updhead", r.newer.length === 1 ? "A newer build is out" : r.newer.length + " newer builds are out"));
      for (const n of r.newer) {
        const rel = el("div", "updrel");
        const head = el("div", "updrelhead");
        head.appendChild(el("b", null, "v" + n.ver));
        head.appendChild(el("span", "hint", [n.date, n.size ? (n.size / 1048576).toFixed(1) + " MB" : ""].filter(Boolean).join(" · ")));
        rel.appendChild(head);
        rel.appendChild(n.notes.trim() ? Updates.md(n.notes) : el("p", "hint", "This release has no notes."));
        out.appendChild(rel);
      }
    } else if (r) {
      const say = {
        newest: "You have the newest build.",
        ahead: "This build is newer than every release (the newest is v" + r.newest + ") — a preview or a local build. There is nothing to update to.",
        none: "GitHub lists no releases yet.",
        offline: "Could not reach GitHub" + (r.why === "timeout" ? " — it did not answer in time." : " — you may be offline.") + " The releases are on the release page.",
        limited: "GitHub has had too many checks from this address in the last hour. Try again later, or open the release page.",
        down: "GitHub did not answer as expected" + (r.status ? " (HTTP " + r.status + ")" : "") + ". Try again later, or open the release page.",
      }[r.kind];
      out.appendChild(el("p", r.kind === "newest" || r.kind === "ahead" ? "updok" : "hint", say || "Unexpected answer."));
    }
    box.appendChild(out);
    const row = el("div", "updrow");
    if (r && r.kind === "newer") {
      const open = Updates.link("Open the release page", r.newer[0].page); open.className = "btnlike primary"; open.id = "updOpen";
      row.appendChild(open);
      const later = el("button", null, "Not now"); later.id = "updLater"; row.appendChild(later);
    } else {
      if (r && r.kind !== "newest" && r.kind !== "ahead") { const p = Updates.link("Open the release page", Updates.PAGE); p.className = "btnlike"; p.id = "updOpen"; row.appendChild(p); }
      const chk = el("button", "primary", "Check for updates"); chk.id = "updCheck";
      if (state.checking) chk.disabled = true;
      row.appendChild(chk);
      const cl = el("button", null, "Close"); cl.id = "updClose"; row.appendChild(cl);
    }
    box.appendChild(row);
    if (!r) box.appendChild(el("div", "hint", "Check for updates asks GitHub for its list of releases, once, when you click it. Nothing about you or your work is sent."));
    return box;
  },
  // Opens the panel over the page, or redraws it if it is open.
  open(state){
    if (Updates.close) Updates.close();
    const ov = document.createElement("div");
    ov.className = "updov"; ov.id = "updOverlay";
    let cur = state || {};
    const draw = s => {
      cur = s;
      ov.textContent = "";
      const box = Updates.panel(s);
      ov.appendChild(box);
      const q = id => box.querySelector("#" + id);
      if (q("updClose")) q("updClose").onclick = () => Updates.close();
      if (q("updLater")) q("updLater").onclick = () => Updates.close();
      if (q("updCheck")) q("updCheck").onclick = () => Updates.run(draw, () => cur);
    };
    const esc = ev => { if (ev.code === "Escape") Updates.close(); };
    Updates.close = () => { window.removeEventListener("keydown", esc); ov.remove(); Updates.close = null; };
    ov.addEventListener("pointerdown", e => { if (e.target === ov) Updates.close(); });
    window.addEventListener("keydown", esc);
    document.body.appendChild(ov);
    draw(cur);
  },
  async run(draw, now){
    if (Updates.busy) return;
    Updates.busy = true;
    const base = { whatsNew: now().whatsNew };
    draw(Object.assign({}, base, { checking: true }));
    try {
      const result = await Updates.check();
      if (document.getElementById("updOverlay")) draw(Object.assign({}, base, { result }));
    } catch (e) {
      reportFailure("Checking for updates", e, "updates");
      if (document.getElementById("updOverlay")) draw(Object.assign({}, base, { result: { kind: "down" } }));
    } finally { Updates.busy = false; }
  },

  // After the version changes, this build's notes show once by themselves. The first open of a
  // browser that has never run the app shows nothing (there is no "before" to be new against); a
  // browser that holds settings but no seen version ran a build from before this one, and sees them.
  // A downgrade shows nothing either: an older build's notes are not news. Returns whether it opened.
  bootNotes(){
    let seen, ran;
    try {
      seen = localStorage.getItem(Updates.SEEN_KEY);
      ran = localStorage.getItem("wtss_prefs") != null;
      localStorage.setItem(Updates.SEEN_KEY, APP_VERSION);
    } catch (e) {
      // Storage that cannot be read (a private window, blocked site data) is "cannot know", and the
      // answer to that is to show nothing; core/prefs.js already says the storage is unusable.
      return false;
    }
    const changed = seen ? Updates.cmp(APP_VERSION, seen) > 0 : ran;
    if (!changed || !Updates.ownNotes()) return false;
    Updates.open({ whatsNew: true });
    return true;
  },
};
for (const id of ["buildStamp", "statusVersion"]) {
  const v = $(id);
  if (!v) continue;
  v.onclick = () => Updates.open({});
  v.onkeydown = ev => { if (ev.code === "Enter" || ev.code === "Space") { ev.preventDefault(); Updates.open({}); } };
}
