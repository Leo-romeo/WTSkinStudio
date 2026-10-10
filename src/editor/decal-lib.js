/*==DECALTREE==*/
// ---- Folder paths for the decal library ----
// A folder is just a "a/b/c" string on each index entry; the root is "". Kept PURE and away from
// IndexedDB, because the tree rules are where the bugs live — renaming a folder has to carry its
// whole subtree, deleting one has to decide what happens to the contents, and a legacy entry with
// no folder at all has to land somewhere sensible. All of that is testable in Node with no browser
// (tools/t34_decalfolders.mjs).
//
// Folders are *implied as well as explicit*: a decal whose folder is "a/b" makes "a" and "a/b"
// exist whether or not anything created them. That is what makes the index forward-compatible in
// both directions — an older build that ignores `folder` still lists every decal, and a folder list
// that gets lost still reconstructs from the decals themselves.
const DecalTree = {
  segs(p){ return String(p == null ? "" : p).split("/").map(s => s.trim()).filter(Boolean); },
  norm(p){ return this.segs(p).join("/"); },
  parent(p){ const s = this.segs(p); s.pop(); return s.join("/"); },
  name(p){ const s = this.segs(p); return s.length ? s[s.length - 1] : ""; },
  join(parent, name){ const n = this.cleanName(name); return n ? this.segs(parent).concat(n).join("/") : this.norm(parent); },
  // "/" is the separator, so it cannot appear in a name; the rest is cosmetic tidying.
  cleanName(n){ return String(n == null ? "" : n).replace(/[\/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60); },
  // Everything is under the root, the root included — otherwise a decal sitting at the top level
  // is counted as being in no folder at all, and the root's own totals come out wrong.
  isUnder(path, ancestor){
    const p = this.norm(path), a = this.norm(ancestor);
    if (!a) return true;
    return p === a || p.startsWith(a + "/");
  },
  // every folder that exists, explicit or implied by a decal, plus all their ancestors
  all(folders, decals){
    const out = new Set();
    const addChain = p => { const s = this.segs(p); for (let i = 1; i <= s.length; i++) out.add(s.slice(0, i).join("/")); };
    for (const f of (folders || [])) addChain(f);
    for (const d of (decals || [])) addChain(d.folder);
    return [...out].sort((a, b) => a.localeCompare(b));
  },
  // immediate subfolders of `path`
  children(folders, decals, path){
    const base = this.norm(path), depth = this.segs(base).length;
    return this.all(folders, decals)
      .filter(f => this.isUnder(f, base) && f !== base && this.segs(f).length === depth + 1);
  },
  decalsIn(decals, path){ const base = this.norm(path); return (decals || []).filter(d => this.norm(d.folder) === base); },
  // recursive, so a folder card can say how much is inside it rather than looking empty
  count(decals, path){ return (decals || []).filter(d => this.isUnder(d.folder, path)).length; },
  add(folders, path){
    const p = this.norm(path);
    if (!p) return (folders || []).slice();
    const out = new Set(folders || []);
    const s = this.segs(p);
    for (let i = 1; i <= s.length; i++) out.add(s.slice(0, i).join("/"));
    return [...out];
  },
  // Rename in place: the folder keeps its parent and takes a new last segment. Returns null when
  // the name is empty or already taken, so the caller can say why instead of silently doing nothing.
  rename(folders, decals, from, toName){
    const src = this.norm(from);
    const dst = this.join(this.parent(src), toName);
    if (!src || !dst) return null;
    if (dst === src) return { folders: (folders || []).slice(), decals: (decals || []).slice(), path: src };
    if (this.all(folders, decals).some(f => f.toLowerCase() === dst.toLowerCase())) return null;
    const swap = p => this.isUnder(this.norm(p), src) ? dst + this.norm(p).slice(src.length) : this.norm(p);
    return {
      folders: this.add((folders || []).map(swap), dst),
      decals: (decals || []).map(d => this.isUnder(this.norm(d.folder), src) ? { ...d, folder: swap(d.folder) } : d),
      path: dst,
    };
  },
  // mode "up"  — delete the folder, keep everything: children re-parent one level up, so deleting
  //              "a/b" turns "a/b/c" into "a/c" and moves the decals in "a/b" to "a".
  // mode "all" — delete the folder and everything under it. `removed` lists the decal ids the
  //              caller must then erase from storage; nothing here touches IndexedDB.
  remove(folders, decals, path, mode){
    const src = this.norm(path);
    if (!src) return { folders: (folders || []).slice(), decals: (decals || []).slice(), removed: [] };
    const up = this.parent(src), drop = this.segs(src).length;
    const lift = p => {
      const s = this.segs(p);
      return this.segs(up).concat(s.slice(drop)).join("/");
    };
    if (mode === "all") {
      const doomed = (decals || []).filter(d => this.isUnder(this.norm(d.folder), src));
      return {
        folders: (folders || []).filter(f => !this.isUnder(this.norm(f), src)),
        decals: (decals || []).filter(d => !this.isUnder(this.norm(d.folder), src)),
        removed: doomed.map(d => d.id),
      };
    }
    return {
      folders: (folders || []).filter(f => this.norm(f) !== src).map(f => this.isUnder(this.norm(f), src) ? lift(f) : this.norm(f)).filter(Boolean),
      decals: (decals || []).map(d => this.isUnder(this.norm(d.folder), src) ? { ...d, folder: lift(d.folder) } : d),
      removed: [],
    };
  },
  move(decals, ids, path){
    const to = this.norm(path), set = new Set(ids || []);
    return (decals || []).map(d => set.has(d.id) ? { ...d, folder: to } : d);
  },
  // ---- Variants ----
  // A variant is an ORDINARY index entry that remembers which decal it came from. `base` is always
  // the root id, never another variant, so re-varianting a variant keeps one flat family instead of
  // growing a chain nobody asked for. Nothing else in the library treats these rows specially, so
  // an older build lists every variant as a plain decal and loses only the grouping — the same
  // forward-compatibility the `folder` field has.
  rootId(d){ return (d && (d.base || d.id)) || ""; },
  variantsOf(decals, baseId){ return (decals || []).filter(d => d.id !== baseId && this.rootId(d) === baseId); },
  // Where a new variant is inserted: straight after the last member of its family. A family that
  // scatters across the grid by save time is exactly what "save as variant" exists to prevent.
  // -1 when the base is not in the list at all, which the caller reads as "put it at the front".
  familyEnd(decals, baseId){
    const list = decals || [];
    let last = -1;
    for (let i = 0; i < list.length; i++) if (this.rootId(list[i]) === baseId) last = i;
    return last < 0 ? -1 : last + 1;
  },
  // A variant that keeps the base's exact name is indistinguishable from it in the grid, so a name
  // left untouched gets the next free number in the family: "roundel" → "roundel v2" → "roundel v3".
  variantName(decals, baseId, name){
    const used = new Set((decals || []).filter(d => this.rootId(d) === baseId)
      .map(d => String(d.name == null ? "" : d.name).toLowerCase()));
    const stem = String(name == null || name === "" ? "decal" : name).replace(/\s+v\d+$/i, "");
    for (let n = 2; n < 1000; n++) { const c = stem + " v" + n; if (!used.has(c.toLowerCase())) return c; }
    return stem + " v" + Date.now().toString(36);
  },
  // Search spans every folder — a library you have to navigate to find anything in is worse than
  // a flat one. Matches on the decal name and on the folder it sits in.
  search(decals, q){
    const t = String(q || "").trim().toLowerCase();
    if (!t) return null;
    return (decals || []).filter(d =>
      String(d.name || "").toLowerCase().includes(t) || this.norm(d.folder).toLowerCase().includes(t));
  },
};
/*==ENDDECALTREE==*/
// ---- library (IndexedDB): finished decals, reusable across projects ----
// The index is a flat list; `folder` on each entry is what makes it a tree. Entries written before
// folders existed have no `folder` at all, which DecalTree.norm reads as the root — so an old
// library opens with everything at the top level and nothing to migrate.
const DecalLib = {
  async index(){ return (await idbGet("decalIndex")) || []; },
  async folders(){ return (await idbGet("decalFolders")) || []; },
  // `opts.base` marks this as a variant of an existing decal (see DecalTree's variant notes).
  async add(rec, folder, opts){
    const id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await idbSet("decal:" + id, rec);
    const idx = await this.index();
    const row = { id, name: rec.name, w: rec.w, h: rec.h, surf: rec.surf, at: Date.now(), folder: DecalTree.norm(folder) };
    const base = opts && opts.base;
    if (base) row.base = base;
    const at = base ? DecalTree.familyEnd(idx, base) : -1;
    if (at >= 0) idx.splice(at, 0, row); else idx.unshift(row);
    await idbSet("decalIndex", idx.slice(0, 300));
    if (folder) await idbSet("decalFolders", DecalTree.add(await this.folders(), folder));
    return id;
  },
  async get(id){ return await idbGet("decal:" + id); },
  // Overwrite a decal in place, keeping its id — so anything already pointing at it (a variant's
  // `base`, the card you have selected) still points at the same decal. Returns null when the row
  // is gone, because silently writing a blob no index row references would leak it forever.
  async update(id, rec, folder){
    const idx = await this.index();
    const i = idx.findIndex(r => r.id === id);
    if (i < 0) return null;
    await idbSet("decal:" + id, rec);
    idx[i] = { ...idx[i], name: rec.name, w: rec.w, h: rec.h, surf: rec.surf, at: Date.now(),
      folder: folder == null ? idx[i].folder : DecalTree.norm(folder) };
    await idbSet("decalIndex", idx);
    if (folder) await idbSet("decalFolders", DecalTree.add(await this.folders(), folder));
    return id;
  },
  async remove(id){
    await idbDel("decal:" + id);
    const idx = (await this.index()).filter(r => r.id !== id);
    // A variant must not go on claiming a parent that is gone — a `base` pointing at nothing is how
    // a family count ends up including decals no one can reach. It becomes a plain decal instead.
    for (const r of idx) if (r.base === id) delete r.base;
    await idbSet("decalIndex", idx);
  },
  async addFolder(path){
    const next = DecalTree.add(await this.folders(), path);
    await idbSet("decalFolders", next);
    return next;
  },
  async renameFolder(from, toName){
    const r = DecalTree.rename(await this.folders(), await this.index(), from, toName);
    if (!r) return null;                                  // empty or already taken — caller reports
    await idbSet("decalFolders", r.folders);
    await idbSet("decalIndex", r.decals);
    return r.path;
  },
  async removeFolder(path, mode){
    const r = DecalTree.remove(await this.folders(), await this.index(), path, mode);
    for (const id of r.removed) await idbDel("decal:" + id);
    await idbSet("decalFolders", r.folders);
    await idbSet("decalIndex", r.decals);
    return r.removed.length;
  },
  async moveTo(ids, path){
    await idbSet("decalIndex", DecalTree.move(await this.index(), ids, path));
    if (path) await idbSet("decalFolders", DecalTree.add(await this.folders(), path));
  },
};
async function blobToCanvas(blob){ return toCanvas(await createImageBitmap(blob)); }
function canvasToBlob(c){ return new Promise(r => c.toBlob(r, "image/png")); }

// ---------- The decal editor, as named steps on one object ----------
// ROADMAP 2.4. `openDecalEditor` was the longest function in the app — 198 lines, and CLAUDE.md's
// ceiling is 80 — for the reason every one of them is long: it is six unrelated jobs sharing eight
// local variables, and nothing could be lifted out without threading all eight through it. So the
// eight become one context object, `E`, and each job becomes a method that takes it. That is the
// same move `Composite` made in 4.28(c) and `PartsPanel` before it, and §4 names it: split by
// extracting named steps, onto ONE object rather than twelve new globals.
//
// What is in `E`, and why each thing is shared:
//
//   st        the editor's state — every control writes it and `rebuild` reads all of it
//   orig      the untouched source. Never mutated: every preview is rebuilt from it, which is
//             what makes "Keep as-is" and the background key reversible with no undo inside the
//             dialog (4.2, 2026-08-25)
//   work      the CURRENT result. `rebuild` writes it, and Save and Use are the two readers
//   cnv/info  the preview canvas and its size line, written by `rebuild`
//   rebuild   passed as part of the context rather than closed over, because the surface section
//             is built by `DecalUI` in another module and needs to trigger one
const DecalEd = {
  // The dialog's two columns and the three builders every section below uses. Kept together
  // because they are what "a row in this dialog" means, and a second spelling of it is how two
  // sections come to look different for no reason.
  shell(E, title){
    E.dlg = modalDialog(title, { width: "900px", onClose: () => { openDecalEditor.open = null; } });
    const prev = document.createElement("div"); prev.className = "decprev";
    E.cnv = document.createElement("canvas");
    prev.appendChild(E.cnv);
    E.side = document.createElement("div"); E.side.className = "decside";
    E.dlg.body.append(prev, E.side);
    E.row = (label, el) => {
      const d = document.createElement("div"); d.className = "row";
      if (label) { const l = document.createElement("label"); l.textContent = label; l.style.minWidth = "58px"; d.appendChild(l); }
      d.appendChild(el); E.side.appendChild(d); return d;
    };
    E.head = t => { const h = document.createElement("h4"); h.textContent = t; E.side.appendChild(h); };
    E.range = (min, max, val, oninput) => {
      const i = document.createElement("input"); i.type = "range"; i.min = min; i.max = max; i.value = val;
      const v = document.createElement("span"); v.className = "val"; v.textContent = val;
      i.oninput = () => { v.textContent = i.value; oninput(+i.value); };
      const wrap = document.createElement("span");
      wrap.style.cssText = "display:flex;flex:1;align-items:center;gap:6px";
      wrap.append(i, v);
      return wrap;
    };
    E.btn = (t, fn, title) => {
      const b = document.createElement("button"); b.textContent = t; if (title) b.title = title;
      b.style.cssText = "padding:2px 8px;font-size:11px"; b.onclick = fn; return b;
    };
    return E;
  },
  // Every preview is built from `orig` in one pass, in this order, so no control depends on the
  // order they were touched in and none of them is destructive.
  rebuild(E){
    const st = E.st;
    let c = E.orig;
    E.box = null;                                        // what a crop kept, for `geom`
    if (st.key) c = keyOutBackground(c, st.key, st.tol * 2.2, st.soft);
    if (st.crop) { const at = {}; c = trimTransparent(c, 6, at); if (at.w) E.box = at; }
    if (st.b !== 100 || st.c !== 100 || st.s !== 100 || st.rot || st.flip)
      c = DecalEd.orient(c, st.rot, st.flip, `brightness(${st.b}%) contrast(${st.c}%) saturate(${st.s}%)`);
    E.work = c;
    const look = st.surf === "own" ? st.own : SURF_PRESETS[st.surf];
    const show = st.nPrev ? decalNormalCanvas(c, Math.max(1, look.em || 4)) : c;
    E.cnv.width = show.width; E.cnv.height = show.height;
    ctx2d(E.cnv).drawImage(show, 0, 0);
    if (E.info) E.info.textContent = c.width + "×" + c.height + (st.key ? " · background keyed" : "") + (st.crop ? " · cropped" : "");
  },
  // A quarter turn and a left-right mirror (applied first), drawn the one way everything that follows
  // an edit is drawn — the image in `rebuild`, its depth map in `follow` — so the two cannot come out
  // differently. `filter` is the colour adjustment, which is the image's alone.
  orient(c, rot, flip, filter){
    const rot90 = rot % 180 !== 0;
    const w = rot90 ? c.height : c.width, h = rot90 ? c.width : c.height;
    const o = mkCanvas(w, h), g = ctx2d(o);
    g.translate(w / 2, h / 2);
    g.rotate(rot * Math.PI / 180);
    g.scale(flip ? -1 : 1, 1);
    if (filter) g.filter = filter;
    g.drawImage(c, -c.width / 2, -c.height / 2);
    return o;
  },
  // What the edit did to the image's GEOMETRY, relative to the image the editor was given: the
  // rectangle a crop kept (in that image's pixels; null when nothing was cut), then `rot` degrees
  // clockwise, mirrored first when `flip`. Handed out with the result because whatever is laid over
  // the image has to follow it — a projected decal's frame (`ProjSource.edit`: an uneven margin moves
  // the image's centre) and the relief's depth map (`follow`). ROADMAP 4.2b's review, 2026-09-26.
  geom(E){
    return { w: E.orig.width, h: E.orig.height, box: E.box ? { ...E.box } : null, rot: E.st.rot, flip: !!E.st.flip };
  },
  // `img` — any image stretched over the one the editor was given, which is what a decal's depth map
  // is (`Relief.source` draws it at the decal's size whatever size it came at) — through the same
  // crop, turn and mirror, so it stays on the marking it was made for. Geometry only: the key and
  // the colour adjustments are the image's own. A normal map's vectors are turned with its pixels
  // (`Relief.turnNormals`). The image itself when the edit moved nothing, so an untouched map
  // compares equal and costs no undo step.
  follow(img, g, surf){
    if (!img || !g || (!g.box && !g.rot && !g.flip)) return img;
    let c = toCanvas(img);
    if (g.box) {
      const kx = c.width / g.w, ky = c.height / g.h;
      const w = Math.max(1, Math.round(g.box.w * kx)), h = Math.max(1, Math.round(g.box.h * ky));
      const o = mkCanvas(w, h);
      ctx2d(o).drawImage(c, g.box.x * kx, g.box.y * ky, g.box.w * kx, g.box.h * ky, 0, 0, w, h);
      c = o;
    }
    if (g.rot || g.flip) {
      c = DecalEd.orient(c, g.rot, g.flip);
      const from = Relief.heightFrom(surf);
      if (from !== "depth") Relief.turnNormals(c, g.rot, g.flip, from === "normal-gl");
    }
    return c;
  },
  // The depth map that goes out with the result, to Use and to Save. It used to go out as it came in,
  // so a crop squeezed the whole old map into the cropped image and a quarter turn stretched it to
  // the new shape instead of turning it: the relief landed beside the marking (4.2b's review).
  heightOut(E){ return DecalEd.follow(E.st.height, DecalEd.geom(E), DecalEd.look(E) || E.inSurf); },
  // The preset a Look's NUMBERS are, whatever its `preset` field says, or null — the rule the
  // sidebar's Look select already reads by (`syncProjUI`), so the two cannot name one Look apart.
  presetOf(surf){
    const d = surfDeltas(surf);
    return Object.keys(SURF_PRESETS).find(k => Object.keys(SURF_DELTA_CHAN).every(x => (SURF_PRESETS[k][x] || 0) === d[x])) || null;
  },
  // Background removal. Opens on "Keep as-is" and the state decides what is shown rather than the
  // option order — the editor used to key the corner colour out of every image before anyone had
  // looked at it, which is right on a marking in a white box and destructive on a camouflage tile
  // (ROADMAP 4.2, fixed 2026-08-25; `t50` asserts both halves).
  background(E){
    const st = E.st;
    E.head("Background");
    const sel = document.createElement("select");
    for (const [v, t] of [["off", "Keep as-is"], ["tl", "Corner pixel"], ["white", "White"], ["black", "Black"], ["pick", "Click the image"]]) {
      const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o);
    }
    sel.style.flex = "1";
    sel.value = st.mode;
    sel.onchange = () => {
      st.mode = sel.value;
      const d = ctx2d(E.orig).getImageData(0, 0, 1, 1).data;
      st.key = st.mode === "off" ? null : st.mode === "white" ? [255, 255, 255] : st.mode === "black" ? [0, 0, 0]
        : st.mode === "tl" ? [d[0], d[1], d[2]] : st.key;
      if (st.mode === "pick" && !st.key) setStatus("Click the image to pick the colour to remove", "ok");
      DecalEd.rebuild(E);
    };
    E.modeSel = sel;
    E.row("Key", sel);
    E.row("Tolerance", E.range(0, 100, st.tol, v => { st.tol = v; DecalEd.rebuild(E); }));
    E.row("Feather", E.range(0, 120, st.soft, v => { st.soft = v; DecalEd.rebuild(E); }));
    const cropWrap = document.createElement("label");
    cropWrap.style.cssText = "font-size:11.5px;display:flex;gap:5px;align-items:center";
    const cropCb = document.createElement("input"); cropCb.type = "checkbox";
    cropCb.onchange = () => { st.crop = cropCb.checked; DecalEd.rebuild(E); };
    cropWrap.append(cropCb, document.createTextNode("Crop to content"));
    E.row("", cropWrap);
    // Click-to-pick reads the ORIGINAL, not the preview: the preview is what the key has already
    // removed, so picking off it would sample a hole.
    E.cnv.onclick = e => {
      if (st.mode !== "pick") return;
      const r = E.cnv.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / r.width * E.cnv.width), y = Math.floor((e.clientY - r.top) / r.height * E.cnv.height);
      const d = ctx2d(E.orig).getImageData(Math.max(0, Math.min(E.orig.width - 1, x)), Math.max(0, Math.min(E.orig.height - 1, y)), 1, 1).data;
      st.key = [d[0], d[1], d[2]];
      DecalEd.rebuild(E);
    };
  },
  adjust(E){
    const st = E.st;
    E.head("Adjust");
    E.row("Bright", E.range(20, 250, st.b, v => { st.b = v; DecalEd.rebuild(E); }));
    E.row("Contrast", E.range(20, 250, st.c, v => { st.c = v; DecalEd.rebuild(E); }));
    E.row("Saturate", E.range(0, 250, st.s, v => { st.s = v; DecalEd.rebuild(E); }));
    const rotBtns = document.createElement("span");
    rotBtns.style.cssText = "display:flex;gap:4px;flex:1";
    rotBtns.append(E.btn("⟲ 90°", () => { st.rot = (st.rot + 270) % 360; DecalEd.rebuild(E); }),
      E.btn("⟳ 90°", () => { st.rot = (st.rot + 90) % 360; DecalEd.rebuild(E); }),
      // "Flip", as the projection panel says it: "mirror" is the symmetry copy since 6.2, and this
      // turns the image itself round.
      E.btn("Flip ↔", () => { st.flip = !st.flip; DecalEd.rebuild(E); }, "Mirror the image itself, left to right — not a mirrored copy on the other side of the vehicle"));
    E.row("", rotBtns);
  },
  surface(E){
    E.head("Surface response");
    const surf = DecalUI.surfaceSection(E.st, () => DecalEd.rebuild(E));
    E.row("Look", surf.sel);
    E.row("", surf.preview);
    E.side.appendChild(surf.note);
    E.info = document.createElement("div");
    E.info.className = "hint";
    E.side.appendChild(E.info);
    const note = document.createElement("div");
    note.className = "hint";
    note.textContent = E.st.text
      ? "Saving keeps the text editable, with this surface look, ready to drop on any vehicle. Outline and shadow are set on the decal once it is placed."
      : "Saving keeps the cut-out image and this surface look, ready to drop on any vehicle.";
    E.side.appendChild(note);
  },
  // The Look to hand back, to Use and to Save alike. Rebuilt from the preset table only when the
  // select was MOVED. A Look the table has no name for — an Emboss a depth map was given (a map
  // loaded onto a Look with none sets 8), custom deltas — used to open on the nearest name the select
  // had, and rebuilding from that name replaced the decal's own response with one nobody chose:
  // keying out a background took the relief off. Re-editing a projected decal (ROADMAP 4.2,
  // 2026-09-25) is what put that on every edit; a floating decal had it too. Such a Look opens on
  // "Custom" now (`openDecalEditor`), which is the only value that keeps it, so picking a preset —
  // any preset, the one it was named after too — applies that preset.
  look(E){
    if (E.known && E.st.surf === E.look0) return E.inSurf ? { ...E.inSurf } : null;
    return E.surfOf(E.st.surf);
  },
  // What a save writes. No `normal:` here any more, and that is a deletion rather than an omission:
  // every save used to write a second PNG from `decalNormalCanvas` and the two places that load a
  // decal back read `rec.png` and nothing else — dead storage, one PNG per decal, from the day it
  // was written, with the dialog advertising it.
  //
  // ROADMAP 4.19's last gap was the other direction: "the decal library does not carry a depth map
  // yet, so saving a decal to the library keeps the image and drops the relief". Both halves are
  // here — the depth image as a second blob beside the png, and the relief mode / bevel / invert
  // inside `surf`, where they have always ridden for a `.wtproj`. Additive: a record written before
  // this has no `depth` and reads back as a decal with no relief, which is what it is.
  async rec(E, nm){
    const out = { name: nm, w: E.work.width, h: E.work.height, surf: DecalEd.look(E),
      png: await canvasToBlob(E.work) };
    const hm = DecalEd.heightOut(E);                     // cropped and turned with the image
    if (hm) { out.depth = await canvasToBlob(toCanvas(hm)); out.depthName = E.st.heightName || null; }
    // Text is saved as text (4.50 (3)) — the record beside the image it drew, so the library hands
    // back something that can still be edited — and its loaded font is kept in this browser, which
    // the library outlives the session in.
    if (E.st.text) { out.text = { ...E.st.text }; await TextDecal.keepFont(E.st.text.fontId); }
    return out;
  },
  // Three ways to save an edit of an existing decal, and none of them is a safe default to pick for
  // someone: overwriting loses the original, and quietly saving a copy every time is how a library
  // fills with six near-identical roundels. So it is asked, once, at the moment of saving.
  async saveAs(E, how, ui){
    const from = E.from;
    try {
      const into = ui.folderSel.chosen();
      const typed = ui.nameIn.value.trim();
      let msg;
      if (how === "over") {
        const rec = await DecalEd.rec(E, typed || from.name);
        if (!await DecalLib.update(from.id, rec, into)) {
          setStatus("“" + from.name + "” is no longer in the library — saving it as a new decal instead", "err");
          return DecalEd.saveAs(E, "new", ui);
        }
        msg = "Overwrote “" + rec.name + "”";
      } else if (how === "variant") {
        const base = DecalTree.rootId(from);
        const idx = await DecalLib.index();
        // an untouched name would make the variant unreadable in the grid — number it instead
        const nm = (typed && typed !== from.name) ? typed : DecalTree.variantName(idx, base, from.name);
        await DecalLib.add(await DecalEd.rec(E, nm), into, { base });
        msg = "Saved “" + nm + "” as a variant of “" + from.name + "”";
      } else {
        const rec = await DecalEd.rec(E, typed || "decal");
        await DecalLib.add(rec, into);
        msg = "Saved “" + rec.name + "” to " + (into ? "“" + into + "”" : "your decal library");
      }
      App.decalFolder = into;
      setStatus(msg, "ok");
      ui.bSave.textContent = "Saved ✓";
      setTimeout(() => ui.bSave.textContent = ui.saveLabel, 1400);
      if (E.opts && E.opts.onSaved) E.opts.onSaved();
    } catch (e) { setStatus("Could not save decal: " + e.message, "err"); }
  },
  foot(E, name, onApply){
    const from = E.from;
    const nameIn = document.createElement("input");
    nameIn.type = "text"; nameIn.value = (name || "decal").replace(/\.[^.]+$/, ""); nameIn.style.width = "150px";
    nameIn.title = "Name it is saved under in your decal library";
    // Where it goes, chosen at save time. Defaults to the folder the library was last open in, so
    // importing a run of markings into one folder does not mean moving every one of them afterwards.
    const folderSel = DecalUI.folderSelect();
    const bSave = document.createElement("button");
    const saveLabel = from ? "Save…" : "Save to library";
    bSave.textContent = saveLabel;
    bSave.title = from
      ? "Overwrite “" + from.name + "”, branch a variant off it, or keep both and save this as a new decal"
      : "Save this into your decal library — no vehicle needs to be loaded";
    const ui = { nameIn, folderSel, bSave, saveLabel };
    bSave.onclick = async () => {
      if (!from) return DecalEd.saveAs(E, "new", ui);
      const how = await choiceDialog("“" + from.name + "” — how should this edit be saved?",
        [{ label: "Overwrite it", value: "over", primary: true },
         { label: "Save as a variant of it", value: "variant" },
         { label: "Save as a new decal", value: "new" },
         { label: "Cancel", value: null }]);
      if (how) await DecalEd.saveAs(E, how, ui);
    };
    const bApply = document.createElement("button");
    bApply.className = "primary";
    bApply.textContent = E.st.text ? "Use this text" : "Use this decal";
    bApply.onclick = () => { E.dlg.close(); onApply(E.work, { name: nameIn.value.trim() || name, surf: DecalEd.look(E),
      height: DecalEd.heightOut(E) || null, heightName: E.st.heightName || null, geom: DecalEd.geom(E),
      text: E.st.text ? { ...E.st.text } : null }); };
    E.nameIn = nameIn; E.bApply = bApply; E.bSave = bSave;       // the text section keeps them in step (4.50 (3))
    const bCancel = document.createElement("button");
    bCancel.textContent = "Cancel";
    bCancel.onclick = E.dlg.close;
    const grow = document.createElement("span"); grow.className = "grow";
    E.dlg.foot.append(nameIn, folderSel, bSave, grow, bCancel, bApply);
  },
};
// The editor itself. `src` is any canvas/bitmap; `onApply(canvas, meta)` receives the result.
// `opts.from` is the library row this was opened on, which is what turns Save into a choice between
// overwriting that decal, branching a variant off it and starting a new one; `opts.onSaved` lets
// the library grid refresh behind the dialog. `opts.look` / `opts.height` are the Look and the depth
// image a decal ARRIVES with, so editing one does not throw its relief away (4.19). Neither the
// editor nor saving needs a texture slot — building a library of markings is something you do
// BEFORE a vehicle is loaded, not after.
function openDecalEditor(src, name, onApply, opts){
  // ONE AT A TIME. Holding Ctrl+V fires a `paste` per key repeat and each one used to open its own
  // dialog (reported 2026-09-02); dropping five PNGs did the same, because `addFiles` awaits a call
  // that returns as soon as the dialog is up. A refusal, not a queue — a queue makes the Ctrl+V
  // case worse. The flag is a property of the function, so it costs no new global (§5.6), and
  // `onClose` clears it on all four exits (✕, Escape, backdrop, a button).
  if (openDecalEditor.open) {
    setStatus("The decal editor is already open on “" + openDecalEditor.open + "” — finish or close it, then add the next image", "err");
    return;
  }
  openDecalEditor.open = name || "this image";
  const from = (opts && opts.from) || null;
  // The Look this decal ARRIVES with, whole. It used to be reduced to its preset name here and
  // rebuilt from the preset table on the way out, which silently dropped the three fields 4.19
  // added — the relief mode, the bevel width and the invert flag — so editing a decal, or saving
  // one to the library, threw its relief away and left a Look that no longer described it.
  const inSurf = (opts && opts.look) || (from && from.surf) || null;
  // A decal that already exists — on a sheet, on the model, in the library — arrives with its Look,
  // and "none at all" is one of the Looks it can have. `look` present in `opts` is how a caller says
  // so; then the select opens on "None" rather than on the default a NEW image gets, and an unmoved
  // select hands the Look back as it came (`DecalEd.look`).
  const known = !!inSurf || !!(opts && "look" in opts);
  // ...and the outline and shadow (4.44's sixth candidate), for the same reason.
  const keep = DecalStyle.carry(inSurf);
  // Where the Look select opens. A new image gets the default. A decal that exists opens on the
  // preset its NUMBERS are — "None" when it has no Look at all — and on "Custom", its own, when no
  // preset is. It used to open on the preset the Look was NAMED after: a Gloss 40 / Emboss 8 Look
  // showed "Painted on", the note under it quoted Painted on's +20 / 0, and picking Painted on did
  // nothing, because that was the value it opened on (4.2b's review, 2026-09-26).
  const look0 = !known ? "painted" : !inSurf ? "none" : DecalEd.presetOf(inSurf) || "own";
  // TEXT MODE (4.50 (3)): `opts.text` is a text decal's record. The image is then drawn from the
  // record (`TextUI.section`, which re-renders `orig` on every change) instead of cleaned up, so the
  // background and adjust sections are not offered — keying or cropping a rendered image would be
  // lost at the next edit of the text. Everything after `orig` is the editor as it always was: the
  // Look, Save to library and Use.
  const text = (opts && opts.text) ? TextDecal.norm(opts.text) : null;
  const E = {
    st: { key: null, mode: "off", tol: 25, soft: 45, crop: false, b: 100, c: 100, s: 100, rot: 0, flip: false,
          surf: look0, own: look0 === "own" ? surfDeltas(inSurf) : null, nPrev: false, text,
          height: (opts && opts.height) || null, heightName: (opts && opts.heightName) || null },
    orig: toCanvas(src),
    from, opts, known, inSurf, name0: name || "",
    // A stored look is the delta table's keys plus `preset`, plus whatever relief fields it carries.
    // Through `surfDeltas` rather than by spreading the preset, because the table also carries the
    // select's label and a UI string has no business in a .wtproj — and because that is what picked
    // up wear for free when it became a fourth delta.
    surfOf: k => Object.assign(surfDeltas(SURF_PRESETS[k]), { preset: k }, keep),
  };
  E.work = E.orig;
  E.look0 = E.st.surf;                // where the Look select opened, for `DecalEd.look`
  DecalEd.shell(E, (text ? "Text — " : "Decal editor — ") + (name || (text ? "new text" : "image")));
  if (text) TextUI.section(E);
  else { DecalEd.background(E); DecalEd.adjust(E); }
  DecalEd.surface(E);
  DecalEd.foot(E, name, onApply);
  if (text) TextUI.ready(E);     // the first preview, and Use held until there is lettering to use
  else E.modeSel.onchange();     // draws the first preview; with mode "off" it keys nothing
  return E.dlg;
}
