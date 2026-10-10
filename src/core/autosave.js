"use strict";
// ---------- Autosave: the recovery copy (ROADMAP 4.50(2)) ----------
// A browser tab is more fragile than any desktop painter: it can run out of memory on 8K sheets,
// one Ctrl+W closes it, and a browser update restarts it — and a project here holds hours of work.
// Until 2026-09-25 nothing tracked unsaved changes and nothing kept a copy. This is the half with no
// DOM: the dirty signal, when a copy is due, the store, and the rule for which copies are kept. What
// the user sees — the question before the page closes, the offer on the welcome card, the moments a
// copy is taken — is `Recovery` (ui/recovery.js).
//
// THE DIRTY SIGNAL comes from the undo stack, which every edit already passes through, rather than
// from a flag each tool would have to remember to set. `rev` names the document's STATE, not a count
// of edits: each step carries the revision before and after it, undo puts the old one back, so
// undoing to the state that was saved is clean again. `seq` only ever grows, so no two different
// states share a revision. A change with no step of its own — one that clears the history (a
// texture replaced at a new size, a slot resized) or goes round it (a texture adopted by an empty
// slot, a bake too big to snapshot, the `_n` reset at its own size) — calls `changed()`.
//
// THE COPY IS THE PROJECT FILE, UNZIPPED. `ProjectFile.parts()` is the .wtproj writer; a copy stores
// what it returns as Blobs, and recovering one hands those Blobs back to `loadProject` as a JSZip —
// so a copy meets the same reader and the same version gate as a dropped file, and there is no
// second format to keep in step. It is not zipped on the way in because it does not need to be.
// Measured 2026-09-25 on a jet-sized project — four 4096² slots, 23 sheets, 128 MB of source
// textures and a 19 MB model, 208 MB in all — in headless Chrome, a collection forced first, with a
// timer heartbeat and the Long Tasks API watching the UI thread:
//
//     the .wtproj, DEFLATE 3 (what Save does)   12.8 s   longest block of the UI thread 127 ms
//     the .wtproj, STORE                          3.5 s                                  130 ms
//     the copy, as built here                     2.4 s                                   25 ms, no long task
//
// Both zips are chunked by JSZip and then held the thread once, at the end, to put the whole
// archive together. The sheets cost the thread nothing: `canvas.toBlob` returns in under a
// millisecond and Chrome encodes the PNG on a thread of its own — six 4096² sheets at ~100 ms each
// left no gap over 30 ms, and an OffscreenCanvas in a worker measured the same to the millisecond,
// so there is nothing here for the pool to do. The source textures and the model were the rest: made
// into Blobs in one go they held the thread 128 ms. They are the same bytes all session, so
// `assetBlobs` makes each one once, one per task, and `store` writes them once into a record every
// copy points at — again only when a source changes, or a recovered page takes its first copy —
// rather than to disk again every few minutes.
//
// NOTHING LEAVES THE MACHINE (CLAUDE.md §0.1): IndexedDB is this browser's own storage, and a copy
// holds exactly what a .wtproj on the user's own disk would.
const Autosave = {
  VERSION: 1,                    // of the records below — a .wtproj's own version is inside `meta`
  INDEX_KEY: "autosave.index",
  EVERY_MS: 3 * 60 * 1000,       // unsaved work this old gets a copy at the next quiet moment
  KEEP: 2,                       // copies per session: "keep the last two copies"
  SESSIONS: 3,                   // sessions kept, the current one included
  BOUND: 1024 * 1048576,         // everything kept, in bytes — past it the oldest go first
  seq: 0, rev: 0, savedRev: 0, copiedRev: 0,
  pendingSince: null,            // when the oldest change not yet in a copy was made
  // One piece of work, from a new document to the next: a page load, a vehicle cleared or replaced,
  // a project opened. A recovered copy carries on in its own. Kept per session rather than as one
  // ring of two, so a second document in the same tab — or a second tab — cannot evict the first's
  // unsaved work with copies of its own.
  session: "",
  running: null, last: null, foreign: false, persistAsked: false, persisted: null,
  bufs: new WeakMap(), texts: new Map(), assetSeq: 0,
  // This page load, in every source id `assetBlobs` hands out. The counter starts again at 1 on
  // every load, and a recovered page carries on in its copy's SESSION — so without this its first
  // copy's sources had the same `sig` as a record an earlier page of that session wrote, and `store`
  // pointed the copy at that record even where the bytes behind a path had changed since. Measured in
  // review (2026-09-26): a texture replaced by a file of the same name, then two recoveries — the
  // second brought back the texture as it was before the replacement.
  page: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),

  // ---- the revision ----
  stamp(a){ a.revFrom = this.rev; a.revTo = this.rev = ++this.seq; this.touched(); },
  moveTo(r){ this.rev = r == null ? ++this.seq : r; this.touched(); },
  // A change with no step of its own. No state before it can come back: undoing a step now lands on
  // that step's old state WITH this change still applied, which never existed. So every step still in
  // the history is given revisions no earlier state has, chained from the current one — undo lands
  // somewhere new, and redo back to here is here again, which a save made after this change still
  // matches. Until the review of 2026-09-26 the steps kept their old revisions: an edit, an
  // over-budget bake, undo — and the project called itself saved with the bake still on it.
  changed(){
    this.rev = ++this.seq;
    let r = this.rev;
    for (let i = App.undoStack.length - 1; i >= 0; i--) { const a = App.undoStack[i]; a.revTo = r; a.revFrom = r = ++this.seq; }
    r = this.rev;
    for (let i = App.redoStack.length - 1; i >= 0; i--) { const a = App.redoStack[i]; a.revFrom = r; a.revTo = r = ++this.seq; }
    this.touched();
  },
  // A step that absorbed one already taken off the history — a stroke and the layer it had to make
  // (editor/strokes.js) — starts where the absorbed one did. Without this, undoing the pair landed on
  // the revision between the two, which is no state at all: one stroke on a vehicle just loaded,
  // undone, and the page still asked before it closed.
  fold(a, first){ if (a && first && first.revFrom != null) a.revFrom = first.revFrom; },
  touched(){ if (this.pendingSince == null) this.pendingSince = Date.now(); },
  dirty(){ return this.rev !== this.savedRev; },
  // A pointer went down while a copy was being taken: whatever it starts may change a sheet before
  // it changes the revision (a stroke is only committed on release), so the copy is abandoned rather
  // than risked — a copy with half a stroke in it would pass the revision check. It is taken again at
  // the next quiet moment.
  interrupt(){ if (this.running && this.running.reason !== "test") this.running.stopped = true; },
  // The file on disk now holds `rev` (Save). This session's copies are superseded by it and are
  // marked so, which is what keeps a later visit from offering work that is safely in a file.
  saved(rev){
    this.savedRev = rev;
    if (this.rev !== rev) return;                // edited while it packed: still unsaved, copies stay live
    this.pendingSince = null;
    this.markSaved(this.session);
  },
  markSaved(session){
    return this.tx((st, idx) => {
      let n = 0;
      for (const c of idx.copies) if (c.session === session && !c.saved) { c.saved = true; n++; }
      return n > 0;
    }).catch(e => reportFailure("Marking this session's recovery copies as saved", e, "autosave"));
  },
  // A new document. `recovered` is the copy it came out of (Recovery.recover), if it did: that work
  // is in no file, so it stays unsaved, and it carries on in the copy's session so the two copies
  // kept are the latest of ONE piece of work.
  opened(recovered){
    if (this.running) this.running.stopped = true;
    this.session = recovered ? recovered.session : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    this.copiedRev = this.rev;
    this.savedRev = recovered ? -1 : this.rev;
    this.pendingSince = null;
    // The last copy is this document's only if it is the copy the document came out of.
    this.last = recovered ? { at: recovered.at, bytes: (recovered.bytes || 0) + (recovered.assetBytes || 0), ms: 0, reason: "recovered" } : null;
    // A model that went with the old document is not kept alive by the Blob cache (CLAUDE.md §3.8).
    this.texts.clear();
  },
  // Is a copy due? Work in no file, changed since the last copy, the oldest such change at least
  // EVERY_MS old. Whether the user is busy right now is the caller's question (Recovery.tick).
  due(now){
    return !this.running && !this.foreign && this.dirty() && this.rev !== this.copiedRev &&
      this.pendingSince != null && now - this.pendingSince >= this.EVERY_MS &&
      App.slots.size > 0 && !App.pendingProject;
  },

  // ---- taking a copy ----
  // Resolves { ok, entry, ms } or { ok: false, why }. A walk the document moved under is thrown
  // away ("changed") rather than stored: it would be a state the user never had.
  async write(reason){
    if (this.running || !App.slots.size) return { ok: false, why: this.running ? "busy" : "empty" };
    const run = this.running = { rev: this.rev, session: this.session, stopped: false, reason };
    const moved = () => run.stopped || this.rev !== run.rev || this.session !== run.session;
    const t0 = performance.now();
    try {
      const parts = await ProjectFile.parts(moved);
      const assets = await this.assetBlobs(parts.assets, moved);
      if (moved()) return { ok: false, why: "changed" };
      const entry = await this.store(parts, assets, run.session, reason);
      this.copiedRev = run.rev;
      if (this.rev === run.rev) this.pendingSince = null;
      this.last = { at: entry.at, bytes: entry.bytes + entry.assetBytes, ms: Math.round(performance.now() - t0), reason };
      this.askPersist();
      clearFailure("autosave");
      return { ok: true, entry, ms: this.last.ms };
    } catch (e) {
      if (e instanceof Cancelled) return { ok: false, why: "changed" };
      this.pendingSince = Date.now();            // a refused write is retried once per interval, not per tick
      reportFailure("Keeping a recovery copy of this session", e, "autosave");
      return { ok: false, why: "failed", error: errText(e) };
    } finally { this.running = null; }
  },
  // The source textures and the models as Blobs, each made once and reused by every copy after it:
  // they are the same bytes all session. One per task, so a 16 MB texture costs one short task
  // rather than all of them together costing one long one. The third field is an identity for the
  // source, which is how `store` tells that a copy's sources are the ones already stored — unique to
  // this page load (`page`), because no record another page wrote can be known to hold these bytes.
  async assetBlobs(list, stop){
    const out = [], live = new Set();
    for (const [path, data] of list) {
      let hit;
      if (typeof data === "string") {
        live.add(path);
        hit = this.texts.get(path);
        if (!hit || hit.text !== data) this.texts.set(path, hit = { text: data, blob: await this.textBlob(data, stop), id: this.page + "." + (++this.assetSeq), fresh: true });
      } else {
        hit = this.bufs.get(data);
        if (!hit) this.bufs.set(data, hit = { blob: new Blob([data]), id: this.page + "." + (++this.assetSeq), fresh: true });
      }
      out.push([path, hit.blob, hit.id]);
      if (hit.fresh) { hit.fresh = false; await new Promise(r => setTimeout(r, 0)); }
      if (stop && stop()) throw new Cancelled();
    }
    // A model that is no longer loaded is not kept alive by this cache (CLAUDE.md §3.8).
    for (const k of [...this.texts.keys()]) if (!live.has(k)) this.texts.delete(k);
    return out;
  },
  // A model's text is the one source big enough to hold the thread on its own. Measured 2026-09-25 on
  // a 24 MB model: 62 ms as one Blob, 18 ms for the worst 4 M-character piece — and joining the
  // pieces costs 1 ms, because a Blob made of Blobs copies nothing. A 16 MB texture is 10 ms whole.
  async textBlob(text, stop){
    const CH = 4 * 1048576, parts = [];
    for (let i = 0; i < text.length;) {
      let j = Math.min(text.length, i + CH);
      // never between the two halves of a surrogate pair: each half alone would encode as U+FFFD
      if (j < text.length && (text.charCodeAt(j - 1) & 0xFC00) === 0xD800) j--;
      parts.push(new Blob([text.slice(i, j)]));
      i = j;
      await new Promise(r => setTimeout(r, 0));
      if (stop && stop()) throw new Cancelled();
    }
    return new Blob(parts, { type: "text/plain" });
  },
  // One transaction: the sources if this session has not stored these ones yet, the copy, the index
  // listing it, and whatever the keep rule evicts. A tab that dies half-way leaves the store as it was.
  async store(parts, assets, session, reason){
    const at = Date.now();
    const sig = assets.map(a => a[0] + "#" + a[2]).join("|");
    const assetBytes = assets.reduce((n, a) => n + a[1].size, 0);
    let bytes = JSON.stringify(parts.meta).length;
    for (const f of parts.files) bytes += f[1].size;
    const entry = Object.assign({ key: "autosave.copy." + session + "." + at, session, at, bytes, assetBytes,
      assets: null, reason, version: parts.meta.version, app: APP_VERSION, saved: false }, this.describe(parts.meta));
    await this.tx((st, idx) => {
      let ak = Object.keys(idx.assets).find(k => idx.assets[k].session === session && idx.assets[k].sig === sig);
      if (!ak) {
        ak = "autosave.assets." + session + "." + at;
        st.put({ v: this.VERSION, files: assets.map(a => [a[0], a[1]]) }, ak);
        idx.assets[ak] = { session, sig, bytes: assetBytes };
      }
      entry.assets = ak;
      st.put({ v: this.VERSION, meta: parts.meta, files: parts.files }, entry.key);
      idx.copies.unshift(entry);
      const plan = this.retain(idx, session);
      for (const k of plan.drop) st.delete(k);
      idx.copies = plan.copies; idx.assets = plan.assets;
      return true;
    });
    return entry;
  },
  // What the welcome card says about a copy: which vehicle, and how much work is in it.
  describe(meta){
    const u = (App.skinUnits || []).find(x => x.on);
    const count = list => (list || []).reduce((n, L) => n + 1 + (L.children ? count(L.children) : 0), 0);
    return { vehicle: (u && u.unit && u.unit.name) || meta.vehicleId || App.objName || "",
             unit: meta.vehicleId || "", skin: meta.skinName || "", slots: meta.slots.length,
             layers: meta.slots.reduce((n, sm) => n + count(sm.layers), 0) };
  },
  // Which copies are kept — pure, so t93 can hold the rule to cases. `idx.copies` newest first.
  //   * a session keeps its newest KEEP copies: "the last two copies" of one piece of work;
  //   * another session whose newest copy was saved to a file has nothing to recover, and goes;
  //   * at most SESSIONS sessions: the current one and the newest others;
  //   * all of it within `bound` bytes, a shared sources record counted once — evicting first the
  //     older copy of other sessions (oldest session first), then this session's older copy, then
  //     other sessions whole, oldest first. This session's newest copy is never evicted: past the
  //     bound it is kept alone, because one copy beats none.
  retain(idx, session, bound){
    const B = bound == null ? this.BOUND : bound;
    const by = new Map();
    for (const c of [...idx.copies].sort((a, b) => b.at - a.at)) {
      if (!by.has(c.session)) by.set(c.session, []);
      by.get(c.session).push(c);
    }
    const groups = [...by].map(([s, list]) => ({ s, list: list.slice(0, this.KEEP) }));
    const cur = groups.find(g => g.s === session);
    const others = groups.filter(g => g.s !== session && !g.list[0].saved).slice(0, this.SESSIONS - 1);
    const kept = cur ? [cur, ...others] : others;
    const size = () => {
      const seen = new Set();
      let n = 0;
      for (const g of kept) for (const c of g.list) {
        n += c.bytes;
        if (c.assets && !seen.has(c.assets)) { seen.add(c.assets); n += (idx.assets[c.assets] || {}).bytes || 0; }
      }
      return n;
    };
    const oldest = others.slice().reverse();
    const steps = [...oldest.map(g => () => { g.list.length = Math.min(g.list.length, 1); }),
                   () => { if (cur) cur.list.length = Math.min(cur.list.length, 1); },
                   ...oldest.map(g => () => { g.list.length = 0; })];
    for (const step of steps) { if (size() <= B) break; step(); }
    const copies = kept.flatMap(g => g.list).sort((a, b) => b.at - a.at);
    const keys = new Set(copies.map(c => c.key)), used = new Set(copies.map(c => c.assets));
    const assets = {};
    for (const k of Object.keys(idx.assets)) if (used.has(k)) assets[k] = idx.assets[k];
    const drop = idx.copies.filter(c => !keys.has(c.key)).map(c => c.key)
      .concat(Object.keys(idx.assets).filter(k => !used.has(k)));
    return { copies, assets, drop };
  },
  // Chrome may evict a site's storage under pressure unless it is persisted. Asked once per visit, at
  // the first copy — at boot there would be nothing yet to keep. Chrome answers without a prompt,
  // from how the page is used, and `false` is an answer rather than a failure.
  askPersist(){
    if (this.persistAsked) return;
    this.persistAsked = true;
    const S = navigator.storage;
    if (!S || !S.persist) return;
    S.persist().then(v => { this.persisted = v; },
      e => reportFailure("Asking the browser to keep the recovery copies", e, "autosave-persist"));
  },

  // ---- reading them back ----
  // Other sessions whose newest copy holds work in no file — what the welcome card offers, newest
  // first. This session is never offered: its work is the one on screen.
  async offers(){
    const [raw] = await this.get([this.INDEX_KEY]);
    const idx = this.norm(raw);
    if (idx.v > this.VERSION) { this.foreign = true; return { foreign: true, list: [] }; }
    const by = new Map();
    for (const c of [...idx.copies].sort((a, b) => b.at - a.at)) {
      if (!by.has(c.session)) by.set(c.session, []);
      by.get(c.session).push(c);
    }
    const list = [];
    for (const [s, cs] of by) if (s !== this.session && !cs[0].saved)
      list.push(Object.assign({}, cs[0], { copies: cs, total: cs[0].bytes + ((idx.assets[cs[0].assets] || {}).bytes || 0) }));
    return { list };
  },
  // One copy back as the parts the writer made, ready for ProjectFile.zip.
  async read(c){
    const [rec, src] = await this.get([c.key, c.assets || "autosave.none"]);
    if (!rec || !rec.meta) throw new Error("that copy is no longer in this browser's storage");
    if ((rec.v | 0) > this.VERSION) throw new Error("that copy was written by a newer build of the app");
    if (!src) throw new Error("the model and textures that copy was made with are no longer stored");
    return { meta: rec.meta, files: rec.files, assets: src.files };
  },
  // Throw a session away — the user's own call, from the welcome card.
  discard(session){
    return this.tx((st, idx) => {
      const gone = idx.copies.filter(c => c.session === session);
      if (!gone.length) return false;
      idx.copies = idx.copies.filter(c => c.session !== session);
      const used = new Set(idx.copies.map(c => c.assets));
      for (const c of gone) st.delete(c.key);
      for (const k of Object.keys(idx.assets)) if (!used.has(k)) { st.delete(k); delete idx.assets[k]; }
      return true;
    });
  },

  // ---- the store: the page's own IndexedDB (core/idb.js), one key per record ----
  norm(v){
    return v && typeof v === "object" && Array.isArray(v.copies)
      ? { v: (v.v | 0) || 1, copies: v.copies, assets: v.assets || {} }
      : { v: this.VERSION, copies: [], assets: {} };
  },
  async get(keys){
    const db = await idb();
    try {
      return await new Promise((res, rej) => {
        const t = db.transaction("kv"), st = t.objectStore("kv"), out = [];
        keys.forEach((k, i) => { const q = st.get(k); q.onsuccess = () => { out[i] = q.result; }; });
        t.oncomplete = () => res(out);
        t.onerror = t.onabort = () => rej(t.error || new Error("the browser refused to read its storage"));
      });
    } finally { db.close(); }
  },
  // One readwrite transaction over the index and whatever records `fn` touches, so a copy, the index
  // that lists it and the copies it evicts land together or not at all. `fn(store, index)` returns
  // true when it changed the index. An index from a newer build is left exactly as it is.
  async tx(fn){
    const db = await idb();
    try {
      return await new Promise((res, rej) => {
        const t = db.transaction("kv", "readwrite"), st = t.objectStore("kv");
        const rq = st.get(this.INDEX_KEY);
        rq.onsuccess = () => {
          try {
            const idx = this.norm(rq.result);
            if (idx.v > this.VERSION) {
              this.foreign = true;
              throw new Error("the recovery copies in this browser were written by a newer build of the app, and this one will not overwrite them");
            }
            if (fn(st, idx)) st.put(idx, this.INDEX_KEY);
          } catch (e) { rej(e); t.abort(); }
        };
        t.oncomplete = () => res(true);
        t.onerror = t.onabort = () => rej(t.error || new Error("the browser refused to write its storage"));
      });
    } finally { db.close(); }
  },
};
// A page load is a new document like any other.
Autosave.opened();
