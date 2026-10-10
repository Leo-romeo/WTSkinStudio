// ---------- Text: a decal whose image is generated (ROADMAP 4.50 (3)) ----------
// Most aircraft markings are lettering — serials, buzz numbers, unit codes, nose-art names, kill
// tallies — and until this the only route was to make a PNG in another program and drop it in.
// Every relative this app was measured against has a text tool (4.50's reading, 2026-09-25).
//
// **Text is not a new kind of layer.** It is a decal whose image is RENDERED from a record — the
// `text` field below, on the image content of a floating decal and on a projection's shared
// parameters — and re-rendered whenever the record is edited. So everything a decal already has
// works on it unchanged, because it IS a decal: the Look, the outline and the shadow (drawn round
// the rendered image by `DecalStyle`), projection, a mirrored copy whose lettering stays readable,
// the library, the `.wtproj`. Editing projected text is `ProjSource.set(P, { bmp, text })` — the
// re-edit 4.2b built for exactly this — so the undo step, the re-projection and the letter size kept
// through a longer string come with it.
//
// **The image box is the LAYOUT box, not the ink.** A bitmap trimmed to its ink would move its centre
// — and so the marking on the model — every time a letter with a descender came or went. The box is
// the lines' advance widths by ascent + descent + the line gaps, from the font's own metrics, padded
// the same amount on opposite sides (only as much as some ink actually overhangs, plus two pixels
// of antialiasing), so the image's centre is always the layout's centre and a baseline never moves
// because a letter changed. `at` then keeps the ALIGNED edge in place across an edit, the way point
// text behaves in an image editor: left-aligned text grows to the right, a new line grows down.
//
// **Fonts.** Any installed font, by name, through the canvas — and font FILES the user loads (TTF,
// OTF, WOFF, WOFF2) through the FontFace API from an ArrayBuffer, which works on a `file://` page.
// A loaded font is registered under a family of its own, `wtss-<hash of its bytes>`, so it can never
// be mistaken for an installed font of the same name, and it is kept in IndexedDB beside the decal
// library. A project embeds the files its text uses — `fonts/` in the zip, with a note that a font's
// licence travels with the project — and registers them again when it is opened, so its text stays
// editable on a machine that never had the font. Nothing leaves the machine (§0.1): the bytes go
// from the user's own file into this browser's storage and their own project, and nowhere else.
//
// One binding (§2: no new bare globals). The dialog is `TextUI` in ui/panels/text.js — the decal
// editor in its text mode (`openDecalEditor(…, { text })`).
const TextDecal = {
  // The record, as the item names it. `size` is the font size in the image's own pixels (the
  // decal's Scale / Size then sets how big that is on the vehicle), `weight` a CSS weight,
  // `tracking` thousandths of an em between letters (an image editor's unit, so it survives a size
  // change), `leading` the line spacing as a percentage of the size. `fontId` names a loaded font
  // file; `font` is the family asked for, and the fallback when that file is not here.
  DEF: { string: "", font: "sans-serif", fontId: null, size: 160, weight: 700, tracking: 0, leading: 120, align: "center", colour: "#ffffff" },
  RANGE: { size: [8, 512], weight: [100, 900], tracking: [-500, 2000], leading: [50, 400] },
  ALIGN: ["left", "center", "right"],
  GENERIC: ["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"],
  // Bigger than any sheet a decal lands on is useless and a canvas this size is 268 MB; the dialog
  // refuses it with a sentence rather than letting the browser fail somewhere later.
  MAX: 8192,
  PAD: 2,

  // ---- the record ----
  // Clamped and defaulted. A record read from a file is kept exactly as it came until it is EDITED —
  // a field a newer build added is not this build's to drop on load — and normalised from then on.
  norm(t){
    const d = TextDecal.DEF, o = Object.assign({}, d, t || {});
    const num = k => { const v = +o[k], r = TextDecal.RANGE[k]; return Number.isFinite(v) ? Math.max(r[0], Math.min(r[1], v)) : d[k]; };
    return {
      string: String(o.string == null ? "" : o.string).replace(/\r\n?/g, "\n"),
      font: String(o.font || d.font).replace(/[\u0000-\u001f"\\]/g, "").trim() || d.font,
      fontId: o.fontId ? String(o.fontId) : null,
      size: Math.round(num("size")), weight: Math.round(num("weight") / 100) * 100,
      tracking: Math.round(num("tracking")), leading: Math.round(num("leading")),
      align: TextDecal.ALIGN.includes(o.align) ? o.align : d.align,
      colour: /^#[0-9a-f]{6}$/i.test(o.colour) ? String(o.colour).toLowerCase() : d.colour,
    };
  },
  same(a, b){ return JSON.stringify(TextDecal.norm(a)) === JSON.stringify(TextDecal.norm(b)); },
  blank(t){ return !TextDecal.norm(t).string.trim(); },
  // What a new text decal is called: its first line, as far as a layer row has room for.
  nameOf(t){
    const line = (TextDecal.norm(t).string.split("\n").find(s => s.trim()) || "").trim();
    return line ? (line.length > 32 ? line.slice(0, 31) + "…" : line) : "Text";
  },
  // A CSS font shorthand. The loaded file first, then the family by name — the fallback when the
  // file is not in this browser, and the whole answer for an installed font — then sans-serif, so
  // a name this computer does not have draws SOMETHING rather than 10-px default text. A generic
  // family must not be quoted: `"serif"` is a family literally called serif.
  quote(f){ return TextDecal.GENERIC.includes(f) ? f : '"' + String(f).replace(/[\u0000-\u001f"\\]/g, "") + '"'; },
  css(r){
    const stack = [];
    if (r.fontId) stack.push('"wtss-' + r.fontId + '"');
    stack.push(TextDecal.quote(r.font));
    if (r.font !== "sans-serif") stack.push("sans-serif");
    return r.weight + " " + r.size + "px " + stack.join(", ");
  },
  // User-perceived characters, so tracking never splits an accented letter from its accent.
  graphemes(s){
    if (!s) return [];
    if (!Intl.Segmenter) return Array.from(s);
    if (!TextDecal._seg) TextDecal._seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(TextDecal._seg.segment(s), x => x.segment);
  },
  probe(){ return TextDecal._probe || (TextDecal._probe = ctx2d(mkCanvas(1, 1))); },
  fin(v, dflt){ return Number.isFinite(v) ? v : dflt; },
  // Tracking is the canvas's own `letterSpacing` (Chrome and Edge 99), set on the context that
  // measures a line and on the one that draws it. It used to be done by hand — each letter drawn on
  // its own, in the order it was TYPED, from the left — which drew Hebrew and Arabic backwards the
  // moment Tracking moved off 0, and Arabic unjoined (4.50 (3)'s review, 2026-09-26). The line is
  // now shaped and drawn whole, so the bidi order and the joins are the browser's, as they are
  // untracked. A context without it cannot track at all: the text is then laid out and drawn
  // untracked, and the dialog says so (`TextUI.check`). Assigning `font` does not reset it —
  // measured — so every use of the shared probe sets it.
  canTrack(){ return "letterSpacing" in TextDecal.probe(); },
  spacing(g, px){ if ("letterSpacing" in g) g.letterSpacing = px + "px"; },

  // ---- layout and drawing ----
  // Where every line goes, and how big the image is — nothing drawn. `lw` × `lh` is the layout box:
  // the widest line's advance by the first ascent, the line gaps and the last descent. Tracking adds
  // BETWEEN letters, never after the last, so a line's width is what the browser draws spaced, less
  // the step after its last letter (`width`).
  layout(t){
    const r = TextDecal.norm(t), g = TextDecal.probe();
    g.font = TextDecal.css(r);
    const track = TextDecal.canTrack() ? r.tracking / 1000 * r.size : 0, lineH = r.size * r.leading / 100;
    TextDecal.spacing(g, 0);
    const m0 = g.measureText("Hg");                      // the font's own ascent and descent
    const asc = TextDecal.fin(m0.fontBoundingBoxAscent, r.size * .8), desc = TextDecal.fin(m0.fontBoundingBoxDescent, r.size * .2);
    const lines = r.string.split("\n").map(s => TextDecal.width(g, s, track));
    TextDecal.spacing(g, 0);
    const lw = Math.max(0, ...lines.map(l => l.w));
    const lh = asc + desc + (lines.length - 1) * lineH;
    const over = TextDecal.overhang(lines, r.align, lw, lh, asc, lineH);
    const padX = Math.ceil(Math.max(over.l, over.r, 0)) + TextDecal.PAD, padY = Math.ceil(Math.max(over.t, over.b, 0)) + TextDecal.PAD;
    const bw = Math.ceil(lw), bh = Math.ceil(lh);
    return { r, lines, track, lineH, asc, desc, lw, lh, padX, padY, W: bw + 2 * padX, H: bh + 2 * padY,
             ox: padX + (bw - lw) / 2, oy: padY + (bh - lh) / 2 };
  },
  // One line, measured the way it is drawn: `m` is its metrics WITH the spacing, so the ink box the
  // pad is sized from is where the ink really lands, and `w` is that advance less the step after
  // the RIGHTMOST letter — not "(n − 1) steps", because which letters get a step is the browser's
  // call. Chrome steps every grapheme to its right in visual order, Hebrew included, and leaves
  // Arabic, a joined script, unspaced: measured 2026-09-26 (Chrome 154, Arial 80 px, 20 px spacing),
  // "שלום" grew by 4 steps with its left ink edge unmoved, "سلام" not at all, and "سلام 117" by
  // the four steps of its space and digits with none after its rightmost letter, which is Arabic.
  // So the step at the end is read off the metrics — how much further the advance runs past the ink
  // once spaced than unspaced: one step, none, or two when the line ends in a space (its own and the
  // one before it; one step between each pair keeps the one before it).
  width(g, s, track){
    const gs = TextDecal.graphemes(s);
    if (!gs.length) return { s, gs, m: null, w: 0 };
    TextDecal.spacing(g, 0);
    const m0 = g.measureText(s);
    if (!track) return { s, gs, m: m0, w: m0.width };
    TextDecal.spacing(g, track);
    const m = g.measureText(s), fin = TextDecal.fin;
    const tail = (m.width - fin(m.actualBoundingBoxRight, m.width)) - (m0.width - fin(m0.actualBoundingBoxRight, m0.width));
    return { s, gs, m, w: m.width - Math.max(0, Math.min(1, Math.round(tail / track))) * track };
  },
  // How far any line's INK reaches past the layout box on each side (an italic's overhang, a
  // swash). Each line's x offset is set here too, from the alignment. The pad is made symmetric by
  // the caller, which is what keeps the image's centre on the layout's centre.
  overhang(lines, align, lw, lh, asc, lineH){
    const o = { l: 0, r: 0, t: 0, b: 0 };
    lines.forEach((l, i) => {
      l.x = align === "left" ? 0 : align === "right" ? lw - l.w : (lw - l.w) / 2;
      if (!l.gs.length) return;
      const base = asc + i * lineH;
      o.l = Math.max(o.l, TextDecal.fin(l.m.actualBoundingBoxLeft, 0) - l.x);
      o.r = Math.max(o.r, l.x + TextDecal.fin(l.m.actualBoundingBoxRight, l.w) - lw);
      o.t = Math.max(o.t, TextDecal.fin(l.m.actualBoundingBoxAscent, 0) - base);
      o.b = Math.max(o.b, base + TextDecal.fin(l.m.actualBoundingBoxDescent, 0) - lh);
    });
    return o;
  },
  // What is wrong with drawing this record, in words, or null. The dialog shows it and holds Use.
  problem(t){
    const L = TextDecal.layout(t);
    if (!L.r.string.trim()) return "Type the lettering first";
    if (L.W > TextDecal.MAX || L.H > TextDecal.MAX)
      return "Too big to draw: " + L.W + " × " + L.H + " pixels, and the most a text image can be is " + TextDecal.MAX + " — shorten a line or lower the size";
    return null;
  },
  // The image. A pure function of the record and the fonts this browser has: the same record gives
  // the same bytes, which is what lets a re-edit be compared, a project be reopened and the gate
  // (t113) hold it against a font it built itself. Every line is drawn whole, tracked or not, so its
  // letter order, kerning and joins are the browser's shaping of it (`spacing`).
  render(t){
    const L = TextDecal.layout(t);
    if (L.W > TextDecal.MAX || L.H > TextDecal.MAX) throw new Error(TextDecal.problem(t));
    const c = mkCanvas(L.W, L.H), g = ctx2d(c);
    g.font = TextDecal.css(L.r);
    g.fillStyle = L.r.colour; g.textAlign = "left"; g.textBaseline = "alphabetic";
    TextDecal.spacing(g, L.track);
    L.lines.forEach((l, i) => { if (l.gs.length) g.fillText(l.s, L.ox + l.x, L.oy + L.asc + i * L.lineH); });
    return c;
  },
  // Where the NEW text's image centre goes, in the OLD image's pixels — the `at` that
  // `ProjSource.set` takes — so the point the text is aligned on stays where it was: the left edge of
  // left-aligned text, the right edge of right-aligned, the middle of centred, and the first
  // baseline always. The new alignment's point is used on both layouts, so switching alignment
  // re-aligns the lines inside the box without moving the box. Null when that is the centre (nothing
  // moves), which it always is for one line of centred text.
  at(oldT, newT, oldImg){
    if (!oldT || !newT || !oldImg) return null;
    const a = TextDecal.layout(oldT), b = TextDecal.layout(newT), al = b.r.align;
    const ax = L => al === "left" ? 0 : al === "right" ? L.lw : L.lw / 2;
    const x = oldImg.width / 2 - a.lw / 2 + ax(a) + b.lw / 2 - ax(b);
    const y = oldImg.height / 2 - a.lh / 2 + a.asc + b.lh / 2 - b.asc;
    return Math.abs(x - oldImg.width / 2) < 1e-6 && Math.abs(y - oldImg.height / 2) < 1e-6 ? null : [x, y];
  },
  // Is a font by this name on this computer? A canvas cannot list them, but it can tell: a family it
  // does not have falls back, so the test string measures exactly what the fallback alone does.
  // Checked against two fallbacks, because a real font can happen to match one of them in width.
  installed(family){
    if (TextDecal.GENERIC.includes(family)) return true;
    const g = TextDecal.probe(), s = "mmmmmmmmmmlli10OQ@#WwKk", q = TextDecal.quote(family);
    TextDecal.spacing(g, 0);
    for (const fb of ["monospace", "serif"]) {
      g.font = "72px " + fb; const w0 = g.measureText(s).width;
      g.font = "72px " + q + ", " + fb;
      if (g.measureText(s).width !== w0) return true;
    }
    return false;
  },

  // ---- fonts the user loads ----
  // id -> { id, name, fmt, bytes, face }. What this session has registered: loaded from a file, out
  // of IndexedDB, or out of a project. IndexedDB holds `font:<id>` (the bytes) and `fontIndex`.
  fonts: new Map(),
  // A 53-bit hash of the bytes, so the same file loaded twice is one font and a project that embeds
  // it finds it again by the same name. Not a security measure — a name.
  hash(bytes){
    let h1 = 0xdeadbeef ^ bytes.length, h2 = 0x41c6ce57 ^ bytes.length;
    for (let i = 0; i < bytes.length; i++) { const b = bytes[i]; h1 = Math.imul(h1 ^ b, 2654435761); h2 = Math.imul(h2 ^ b, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  },
  // The container, from its first four bytes — for the file's extension inside a project.
  fmtOf(bytes){
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    return tag === "OTTO" ? "otf" : tag === "wOFF" ? "woff" : tag === "wOF2" ? "woff2" : "ttf";
  },
  // Register a font file's bytes. Resolves to its entry; rejects, with a sentence, on a file this
  // browser cannot read as a font — the FontFace load is the check, so nothing half-registers.
  // `opts.id` keeps the name a project stored; `opts.persist` also keeps it in this browser.
  async addFont(buf, name, opts){
    const bytes = new Uint8Array(buf.slice(0));
    const id = (opts && opts.id) || TextDecal.hash(bytes);
    let f = TextDecal.fonts.get(id);
    if (!f) {
      const face = new FontFace("wtss-" + id, bytes.slice().buffer);
      try { await face.load(); }
      catch (e) { throw new Error("“" + (name || "that file") + "” is not a font this browser can read (TTF, OTF, WOFF or WOFF2)"); }
      document.fonts.add(face);
      f = { id, name: String(name || "font").replace(/\.(ttf|otf|woff2?)$/i, "").trim() || "font", fmt: TextDecal.fmtOf(bytes), bytes, face };
      TextDecal.fonts.set(id, f);
    }
    if (opts && opts.persist) await TextDecal.keepFont(id);
    return f;
  },
  async loadFontFile(file){
    return TextDecal.addFont(await file.arrayBuffer(), file.name, { persist: true });
  },
  // Into this browser's storage, if it is not there yet: a font loaded from a file always is; one
  // that arrived inside a project only when text using it is saved to the library, which outlives
  // the session.
  async keepFont(id){
    const f = id && TextDecal.fonts.get(id);
    if (!f) return false;
    const idx = (await idbGet("fontIndex")) || [];
    if (idx.some(r => r.id === id)) return true;
    await idbSet("font:" + id, { id, name: f.name, fmt: f.fmt, bytes: f.bytes.slice().buffer });
    idx.push({ id, name: f.name, fmt: f.fmt, at: Date.now() });
    await idbSet("fontIndex", idx);
    return true;
  },
  // Make sure a record's font is registered before it is drawn. False when it is nowhere — then the
  // text falls back to the family by name, and the dialog says so.
  async ensureFont(id){
    if (!id) return true;
    if (TextDecal.fonts.has(id)) return true;
    const rec = await idbGet("font:" + id);
    if (!rec || !rec.bytes) return false;
    try { await TextDecal.addFont(rec.bytes, rec.name, { id }); return true; }
    catch (e) { reportFailure("reading the font “" + rec.name + "” back out of this browser's storage", e, "font"); return false; }
  },
  // Every font the dialog can offer: this session's and this browser's, by name.
  async fontList(){
    const out = new Map();
    for (const r of ((await idbGet("fontIndex")) || [])) out.set(r.id, { id: r.id, name: r.name });
    for (const f of TextDecal.fonts.values()) out.set(f.id, { id: f.id, name: f.name });
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  },

  // ---- fonts inside a project ----
  // The loaded fonts `nodes` (a slot's layer list, or a node) draw with — a floating text decal's
  // and a projected one's.
  fontIds(nodes, into){
    const ids = into || new Set();
    for (const L of layerLeaves(nodes)) for (const ch of LayerNode.channelsOf(L)) {
      const c = L.chans[ch], t = c.text || (c.proj && c.proj.text);
      if (t && t.fontId) ids.add(t.fontId);
    }
    return ids;
  },
  README: "These font files are here because text in this project is drawn with them, so it stays " +
    "editable wherever the project is opened. A font's licence travels with it: sharing this project " +
    "shares these fonts, so share it only where their licences allow.\r\n",
  // The same note, for the status line of the save that embedded them.
  fontNote(n){ return n ? ", and " + n + " font" + (n === 1 ? "" : "s") + " — a font's licence travels with the project" : ""; },
  // The files, as [path, Blob] pairs for a zip — `ProjectFile.parts` hands them to the .wtproj and to
  // the recovery copy alike (4.50 (2) keeps its copy as the file's parts, and counts their bytes by
  // `Blob.size`) — with the README among them, and the list in `meta.fonts`. A font this browser no
  // longer has is left out and the text keeps its rendered image — it simply draws in the fallback if
  // it is edited — and that is said, not swallowed.
  async fontFiles(meta, ids){
    const out = [], list = [];
    for (const id of ids) {
      let f = TextDecal.fonts.get(id);
      if (!f && await TextDecal.ensureFont(id)) f = TextDecal.fonts.get(id);
      if (!f) { reportFailure("saving a font into the project — it is no longer in this browser, so its text will draw in a fallback font if edited", new Error(id), "font-embed"); continue; }
      const file = "fonts/" + id + "." + f.fmt;
      out.push([file, new Blob([f.bytes], { type: "font/" + f.fmt })]);
      list.push({ id, name: f.name, fmt: f.fmt, file });
    }
    if (list.length) { meta.fonts = list; out.push(["fonts/README.txt", new Blob([TextDecal.README], { type: "text/plain" })]); }
    return out;
  },
  // Register what a project embeds — for this session only: opening someone's project should not
  // quietly add their fonts to this browser's list for good. Saving its text to the library does.
  async restoreFonts(meta, zip){
    let n = 0;
    for (const e of (meta && Array.isArray(meta.fonts) ? meta.fonts : [])) {
      const zf = e && e.file && zip.file(e.file);
      if (!zf) continue;
      try { await TextDecal.addFont(await zf.async("arraybuffer"), e.name, { id: e.id }); n++; }
      catch (err) { reportFailure("restoring the font “" + (e.name || e.id) + "” this project carries", err, "font"); }
    }
    return n;
  },

  // ---- editing a floating text decal ----
  // One undo step for the image, the record, the place, the Look, the depth image and the name
  // together. The place moves only to keep the aligned edge where it was (`at`), in the decal's own
  // axes on the sheet — its turn and flip — and a mirrored copy moves the mirrored way. The outline
  // keeps its width when the image's shorter side changes (`DecalStyle.refit`, as a projected
  // decal's re-edit does), the Look is re-derived from the new footprint, and a depth image stays
  // where the old lettering was (`moveMap`). Null when nothing changed; `{ gone: true }` when the
  // decal is on the sheet no more — deleted or undone away while the dialog was open — since
  // re-drawing it then would edit a layer that no step can bring back, and report it re-drawn
  // (4.50 (3)'s review: it did).
  applyFloating(slot, L, img, meta){
    if (!slot || !nodeOwner(slot.layers, L)) return { gone: true };
    if (L.text && TextDecal.same(meta.text, L.text)) img = L.bmp;     // typed and typed back: no new image
    const before = { bmp: L.bmp, text: L.text, x: L.x, y: L.y, sym: L.sym || null, surf: L.surf, name: L.name, heightMap: L.heightMap || null };
    const swap = img !== L.bmp;
    const after = Object.assign({}, before, { text: { ...meta.text }, name: meta.name || L.name, bmp: img,
      surf: swap && meta.surf ? DecalStyle.refit(meta.surf, Math.min(L.bmp.width, L.bmp.height), Math.min(img.width, img.height)) : (meta.surf || null) });
    const at = swap ? TextDecal.at(L.text, meta.text, L.bmp) : null;
    if (at && slot.composite) Object.assign(after, TextDecal.shift(L, at, slot.composite.width, slot.composite.height));
    if (swap) after.heightMap = TextDecal.moveMap(before.heightMap, L.bmp, img, at);
    if (!swap && JSON.stringify({ ...before, bmp: 0, heightMap: 0 }) === JSON.stringify({ ...after, bmp: 0, heightMap: 0 })) return null;
    const apply = v => {
      L.bmp = v.bmp; L.text = v.text; L.x = v.x; L.y = v.y; L.sym = v.sym; L.surf = v.surf; L.name = v.name; L.heightMap = v.heightMap;
      scheduleComposite(slot); ensureDecalSurface(slot, L);
      if (App.activeLayer === L) { syncDecalUI(); applyDecalSurfUI(L); ReliefUI.sync(); StyleUI.sync(); }
      refreshLayerList(); draw2D();
    };
    const px = c => c ? c.width * c.height * 4 : 0;
    pushAction("edit text", () => apply(before), () => apply(after), swap ? px(before.bmp) + px(img) +
      (after.heightMap !== before.heightMap ? px(before.heightMap) + px(after.heightMap) : 0) : 0);
    apply(after);
    return after;
  },
  // A depth image is laid over the image it belongs to at whatever size it has (`Relief.source`
  // stretches it), and a text's is made for the lettering it was loaded on. Re-drawn text keeps its
  // letters their size, so the map keeps its own: it moves with the aligned edge, the way the old
  // letters do (`at`, in old-image pixels; the centre when null), on a canvas the new image's size
  // at the map's own resolution. The letters that stayed keep their relief and new ones get none —
  // where a stretch put a relief made for "ILL" across every letter of "ILLL" (4.50 (3)'s review).
  // Nothing moved and nothing grew: the map itself, so an unchanged layout costs no copy.
  moveMap(map, oldImg, newImg, at){
    if (!map || !oldImg || !newImg || newImg === oldImg) return map || null;
    const kx = map.width / oldImg.width, ky = map.height / oldImg.height;
    const dx = (newImg.width / 2 - (at ? at[0] : oldImg.width / 2)) * kx, dy = (newImg.height / 2 - (at ? at[1] : oldImg.height / 2)) * ky;
    const w = Math.max(1, Math.round(newImg.width * kx)), h = Math.max(1, Math.round(newImg.height * ky));
    if (!dx && !dy && w === map.width && h === map.height) return map;
    const c = mkCanvas(w, h);
    ctx2d(c).drawImage(map, dx, dy, map.width, map.height);
    return c;
  },
  // The sheet move that puts the new image's centre at `at` (old image pixels), for a floating decal
  // at its scale, turn and flip — and for its mirrored copy, drawn at the opposite turn and flip.
  shift(L, at, W, H){
    const dx = at[0] - L.bmp.width / 2, dy = at[1] - L.bmp.height / 2, xs = L.flip ? -1 : 1, k = L.scale;
    const move = (x, y, deg, sx) => {
      const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      return { x: Math.max(0, Math.min(1, x + (c * sx * dx - s * dy) * k / W)), y: Math.max(0, Math.min(1, y + (s * sx * dx + c * dy) * k / H)) };
    };
    const out = move(L.x, L.y, L.rot, xs);
    if (L.sym) out.sym = Object.assign({}, L.sym, move(L.sym.x, L.sym.y, -L.rot, -xs));
    return out;
  },
  // The floating decal's "Edit text…": the decal editor in its text mode, on the record. Waits for
  // the record's font first, so the first re-render is in it.
  // The dialog's result is made from the record and the image it opened on — `at` is measured in
  // that image — so if they are not the decal's any more when Use is pressed, it is refused and said,
  // as a projected decal's edit is (`ProjSource.edit`).
  async editFloating(L, slot){
    await TextDecal.ensureFont(L.text && L.text.fontId);
    const was = { bmp: L.bmp, text: L.text };
    return openDecalEditor(L.bmp, L.name, (canvas, meta) => {
      if (L.bmp !== was.bmp || L.text !== was.text) {
        setStatus("This text was changed while the editor was open — an undo or a redo reached it — so the edit was not applied. Open it again to edit it as it is now", "err");
        return;
      }
      const map = L.heightMap || null, r = TextDecal.applyFloating(slot, L, canvas, meta);
      if (r && r.gone) { setStatus("That text is no longer on the sheet — it was deleted or undone while the editor was open — so there is nothing to re-draw", "err"); return; }
      setStatus(!r ? "Nothing changed — the text is as it was"
        : "Text re-drawn — it stays where it was, its letters the size they were" + TextDecal.mapNote(map, was.text, meta.text) + ". Ctrl+Z puts the old text back", "ok");
    }, { look: L.surf || null, height: L.heightMap || null, heightName: L.heightName || null, text: L.text });
  },
  // The status line's word on a depth image (`moveMap`), when the letters under one were laid out
  // again — a new colour alone leaves every letter where it was, and the map still fits them.
  mapNote(map, oldT, newT){
    const shape = t => ({ ...TextDecal.norm(t), colour: "#000000" });
    return map && oldT && newT && !TextDecal.same(shape(oldT), shape(newT))
      ? "; its depth image was made for the old lettering, so it stays where that was — load one made for the new text to raise every letter" : "";
  },
};
