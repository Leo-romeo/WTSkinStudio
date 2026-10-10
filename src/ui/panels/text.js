// ---------- The text tool's controls (ROADMAP 4.50 (3)) ----------
// The text tool is the decal editor in its text mode (`openDecalEditor(…, { text })`): the preview,
// the Look, Save to library and Use are the editor's own, and this is the one section it swaps in
// for background removal and adjust — the lettering, its font, weight, size, tracking, leading,
// alignment and colour. Every control writes the working record (`E.st.text`) and the image is drawn
// again from it (`TextDecal.render`), so nothing here is destructive and the preview is what Use
// places. One binding, beside `DecalUI` (§2).
const TextUI = {
  // Families worth offering by name. A canvas cannot list what is installed, so this is a list of
  // likely ones filtered by `TextDecal.installed`; "Another installed font…" takes any other name.
  // Windows first, because that is where War Thunder runs; the stencil and condensed faces are the
  // ones military lettering is set in.
  FAMILIES: ["Arial", "Arial Black", "Arial Narrow", "Bahnschrift", "Calibri", "Cambria", "Candara", "Consolas",
    "Constantia", "Corbel", "Courier New", "Franklin Gothic Medium", "Georgia", "Impact", "Lucida Console",
    "Segoe UI", "Stencil", "Agency FB", "OCR A Extended", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana",
    "Helvetica", "Futura", "DejaVu Sans", "Liberation Sans"],
  WEIGHTS: [[100, "Thin"], [200, "Extra light"], [300, "Light"], [400, "Regular"], [500, "Medium"],
    [600, "Semibold"], [700, "Bold"], [800, "Extra bold"], [900, "Black"]],
  // A new text decal: the Layers panel's Text button, T, and the library's "New text…". Use places
  // it the way a decal from the editor is placed (`DecalCarry.place`), carrying its record.
  open(opts){
    const o = opts || {};
    const rec = TextDecal.norm({ string: "" });
    return openDecalEditor(TextDecal.render(rec), "", (canvas, meta) => {
      if (o.onUse) o.onUse();
      DecalCarry.place(canvas, meta, meta.name || TextDecal.nameOf(meta.text));
    }, { text: rec, onSaved: o.onSaved });
  },
  // The section, into the editor's side column.
  section(E){
    const t = E.st.text;
    E.head("Text");
    const ta = document.createElement("textarea");
    ta.rows = 3; ta.value = t.string; ta.spellcheck = false;
    ta.placeholder = "Type the lettering — a serial, a code, a name. Enter starts a new line.";
    ta.style.cssText = "flex:1;resize:vertical;min-height:52px;font:13px/1.35 system-ui";
    ta.oninput = () => { t.string = ta.value; TextUI.redraw(E); };
    E.row("", ta);
    E.textArea = ta;
    TextUI.fontRow(E);
    const wsel = document.createElement("select");
    for (const [v, n] of TextUI.WEIGHTS) { const op = document.createElement("option"); op.value = String(v); op.textContent = v + " · " + n; wsel.appendChild(op); }
    wsel.value = String(t.weight); wsel.style.flex = "1";
    wsel.title = "How heavy the letters are. A loaded font file is one weight; a heavier one is drawn by thickening it.";
    wsel.onchange = () => { t.weight = +wsel.value; TextUI.redraw(E); };
    E.row("Weight", wsel); E.weightSel = wsel;
    TextUI.rangeRow(E, "Size", 8, 512, "size", "Font size, in the image's own pixels. The decal's Scale — or Size once projected — sets how big that is on the vehicle; a bigger size here also draws it sharper, and makes the letters bigger.");
    TextUI.rangeRow(E, "Tracking", -200, 1000, "tracking", "Space between letters, in thousandths of the size: 100 adds a tenth of the size between each pair, a negative number tightens.");
    TextUI.rangeRow(E, "Leading", 50, 300, "leading", "The distance from one line to the next, as a percentage of the size.");
    TextUI.alignRow(E);
    const col = document.createElement("input"); col.type = "color"; col.value = t.colour;
    col.title = "The colour of the letters. An outline or a shadow is added on the decal once it is placed, like on any decal.";
    col.oninput = () => { t.colour = col.value; TextUI.redraw(E); };
    E.row("Colour", col);
    E.textNote = DecalUI.hint("");
    E.side.appendChild(E.textNote);
  },
  rangeRow(E, label, min, max, key, title){
    const r = E.row(label, E.range(min, max, E.st.text[key], v => { E.st.text[key] = v; TextUI.redraw(E); }));
    r.title = title;
    return r;
  },
  // The font select, a Load button and its hidden file input. Filled asynchronously: the loaded
  // fonts come out of IndexedDB and the installed ones are measured.
  fontRow(E){
    const sel = document.createElement("select");
    sel.style.cssText = "flex:1;min-width:0";
    sel.title = "An installed font, or a font file you loaded. Fonts you load stay in this browser.";
    sel.onchange = () => TextUI.pickFont(E, sel.value);
    const pick = document.createElement("input");
    pick.type = "file"; pick.accept = ".ttf,.otf,.woff,.woff2"; pick.style.display = "none";
    pick.onchange = () => { const f = pick.files[0]; pick.value = ""; if (f) TextUI.loadFont(E, f); };
    const load = E.btn("Load…", () => pick.click(),
      "Load a font file — TTF, OTF, WOFF or WOFF2. It stays in this browser, and is saved inside any project whose text uses it: a font's licence travels with the project.");
    const row = E.row("Font", sel);
    row.append(load, pick);
    E.fontSel = sel;
    TextUI.fillFonts(E);
  },
  alignRow(E){
    const t = E.st.text, wrap = document.createElement("span");
    wrap.style.cssText = "display:flex;gap:4px;flex:1";
    const btns = {};
    const sync = () => { for (const a in btns) btns[a].classList.toggle("active", t.align === a); };
    for (const [a, name] of [["left", "Align left"], ["center", "Centre"], ["right", "Align right"]]) {
      const b = E.btn("", () => { t.align = a; sync(); TextUI.redraw(E); }, name + " — which edge stays put when the text is edited, too");
      b.appendChild(TextUI.alignIcon(a));
      b.setAttribute("aria-label", name);
      btns[a] = b; wrap.appendChild(b);
    }
    sync();
    E.row("Align", wrap);
  },
  // Three lines, flush to one side — inline SVG, never an emoji (CLAUDE.md §4).
  alignIcon(a){
    const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "16"); svg.setAttribute("height", "16");
    svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2");
    svg.style.verticalAlign = "middle";
    const rows = { left: [[3, 21], [3, 15], [3, 18]], center: [[3, 21], [7, 17], [5, 19]], right: [[3, 21], [9, 21], [6, 21]] }[a];
    rows.forEach(([x0, x1], i) => {
      const l = document.createElementNS(NS, "line");
      l.setAttribute("x1", x0); l.setAttribute("x2", x1); l.setAttribute("y1", 6 + i * 6); l.setAttribute("y2", 6 + i * 6);
      svg.appendChild(l);
    });
    return svg;
  },
  installedFamilies(){
    return TextUI._fams || (TextUI._fams = TextUI.FAMILIES.filter(f => TextDecal.installed(f)));
  },
  opt(parent, value, label){
    const o = document.createElement("option"); o.value = value; o.textContent = label; parent.appendChild(o); return o;
  },
  group(sel, label, items){
    if (!items.length) return;
    const g = document.createElement("optgroup"); g.label = label;
    for (const [v, n] of items) TextUI.opt(g, v, n);
    sel.appendChild(g);
  },
  async fillFonts(E){
    const sel = E.fontSel, t = E.st.text;
    const loaded = await TextDecal.fontList(), fams = TextUI.installedFamilies();
    const mine = loaded.map(f => ["id:" + f.id, f.name]);
    // The record's own font, when this browser or this computer does not have it — shown as what it
    // is, rather than the select quietly naming another.
    if (t.fontId && !loaded.some(f => f.id === t.fontId)) mine.unshift(["id:" + t.fontId, t.font + " (file not in this browser)"]);
    const here = fams.map(f => ["fam:" + f, f]);
    if (!t.fontId && !fams.includes(t.font) && !TextDecal.GENERIC.includes(t.font))
      here.unshift(["fam:" + t.font, t.font + (TextDecal.installed(t.font) ? "" : " (not on this computer)")]);
    sel.textContent = "";
    TextUI.group(sel, "Loaded fonts", mine);
    TextUI.group(sel, "On this computer", here);
    TextUI.group(sel, "Generic", ["sans-serif", "serif", "monospace"].map(f => ["fam:" + f, f]));
    TextUI.opt(sel, "other", "Another installed font…");
    sel.value = t.fontId ? "id:" + t.fontId : "fam:" + t.font;
    TextUI.check(E);
  },
  async pickFont(E, v){
    const t = E.st.text;
    if (v === "other") {
      const n = await promptValue("The name of a font installed on this computer, as other programs list it", t.fontId ? "" : t.font);
      if (n != null && n.trim()) { t.fontId = null; t.font = TextDecal.norm({ font: n }).font; }
    } else if (v.startsWith("id:")) {
      const id = v.slice(3);
      await TextDecal.ensureFont(id);
      const f = TextDecal.fonts.get(id);
      // A font file is one weight. Drawing it at the Bold the tool starts on would thicken a face
      // that was drawn to be exactly as heavy as it is, so a loaded font starts at Regular.
      if (t.fontId !== id) { t.weight = 400; E.weightSel.value = "400"; }
      t.fontId = id; if (f) t.font = f.name;
    } else { t.fontId = null; t.font = v.slice(4); }
    await TextUI.fillFonts(E);
    TextUI.redraw(E);
  },
  async loadFont(E, file){
    try {
      const f = await TextDecal.loadFontFile(file);
      await TextUI.fillFonts(E);
      await TextUI.pickFont(E, "id:" + f.id);
      setStatus("Loaded the font “" + f.name + "” — it stays in this browser, and is saved inside any project whose text uses it: a font's licence travels with the project", "ok");
    } catch (e) {
      TextUI.check(E, e.message);
      setStatus(e.message, "err");
    }
  },
  // Draw the record again, and say what is wrong with it if anything is. A blank record draws an
  // empty image — the honest preview — and holds Use and Save; one too big to draw keeps the last
  // preview and says why.
  redraw(E){
    const t = E.st.text, why = TextDecal.problem(t), big = !!why && !TextDecal.blank(t);
    if (!big) { E.orig = TextDecal.render(t); DecalEd.rebuild(E); }
    TextUI.hold(E, !!why);
    TextUI.check(E, big ? why : null);
    TextUI.autoName(E);
  },
  hold(E, on){ if (E.bApply) E.bApply.disabled = on; if (E.bSave) E.bSave.disabled = on; },
  // The one line under the controls: what is wrong, then whether the font is really the one asked
  // for, then the licence note for a loaded font.
  check(E, why){
    const t = E.st.text, el = E.textNote;
    if (!el) return;
    let s = why || "";
    if (!s && t.fontId && !TextDecal.fonts.has(t.fontId))
      s = "This text's font file is not in this browser, so it is drawn in “" + t.font + "” if this computer has that, else a fallback. Load the file again to edit it in its own font.";
    else if (!s && !t.fontId && !TextDecal.installed(t.font))
      s = "“" + t.font + "” is not installed on this computer, so the text is drawn in a fallback font.";
    else if (!s && t.tracking && !TextDecal.canTrack())
      s = "This browser cannot space letters, so Tracking is not drawn — Chrome and Edge can, from version 99.";
    el.style.color = s ? "var(--danger)" : "";
    if (!s && t.fontId) s = "A loaded font is saved inside every project that uses it — its licence travels with the project.";
    el.textContent = s;
  },
  // The name box follows the lettering while it still shows the name the lettering gave it; a name
  // typed there by hand is kept.
  autoName(E){
    if (!E.nameIn) return;
    const n = TextDecal.nameOf(E.st.text), v = E.nameIn.value.trim();
    if (!v || v === E.autoWas || v === "decal") E.nameIn.value = n;
    E.autoWas = n;
  },
  // After the footer exists: the first preview, the name box, Use held until there is lettering,
  // and the cursor in the text box. An existing text keeps the image it has until it is edited, so
  // opening it and pressing Use changes nothing.
  ready(E){
    const t = E.st.text;
    E.autoWas = TextDecal.nameOf(t);
    if (E.nameIn) E.nameIn.value = E.name0 || E.autoWas;
    DecalEd.rebuild(E);
    const why = TextDecal.problem(t);
    TextUI.hold(E, !!why);
    TextUI.check(E, why && !TextDecal.blank(t) ? why : null);
    E.dlg.ov.querySelector(".decprev").classList.add("textprev");
    E.textArea.focus();
    E.textArea.setSelectionRange(t.string.length, t.string.length);
  },
  // The floating decal panel's pixel edits — key the background, bake an adjust, reset — change the
  // image IN PLACE, and text is drawn from its record: the next edit of the lettering would draw over
  // them, and a re-edit's undo would put back pixels the record never made. So they are off on text,
  // and say where its colour and its surface are changed instead.
  lockPixels(isText){
    for (const id of ["bgMode", "bgTol", "btnBgApply", "btnDecReset", "dB", "dC", "dS", "btnDecBake"]) {
      const el = $(id);
      if (!el) continue;
      if (el.dataset.tip == null) el.dataset.tip = el.title || "";
      el.disabled = isText;
      el.title = isText ? "Text is drawn from its lettering, so its pixels are not edited here — Edit text… changes its colour, and the Look below its surface" : el.dataset.tip;
    }
  },
  // "Open decal editor…" on an image, "Edit text…" on text — the same button, in both panels.
  label(btn, isText){
    if (!btn) return;
    if (btn.dataset.imgLabel == null) { btn.dataset.imgLabel = btn.textContent; btn.dataset.imgTitle = btn.title; }
    btn.textContent = isText ? "Edit text…" : btn.dataset.imgLabel;
    btn.title = isText
      ? "Change the lettering — its words, font, size, spacing, alignment or colour. It is drawn again where it is, its letters the size they were, and one Ctrl+Z puts the old text back."
      : btn.dataset.imgTitle;
  },
};
$("btnAddText").onclick = () => TextUI.open();
