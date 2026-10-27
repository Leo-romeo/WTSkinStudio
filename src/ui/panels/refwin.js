"use strict";
// ---------- Reference images: a floating window beside the work (ROADMAP 4.50 (12)) ----------
// "The Market wants reference photos for a historical camouflage, and skinners work beside photos
// and colour charts. Today: there are recent colours and nothing else." So a window that floats
// over the views and holds the photos you paint from: zoom with the wheel about the pointer, pan by
// dragging, and a click (a press that does not move) picks the colour under it into the brush —
// the 2-D view's eyedropper, pointed at the photo instead of the sheet.
//
// **Local files only, and kept in the project only if asked.** Images arrive from a file chooser or
// a drop onto the window; nothing is fetched (§0.1). They are often someone else's photographs, so a
// project carries them only when *Save with the project* is ticked — off by default, and per
// project: a file saved with it ticked comes back with it ticked. Saved, each is its own bytes as
// it arrived (`refs/rN.<ext>`, beside a `refs` list in project.json), not a re-encode, because a
// JPEG photo re-encoded as PNG is several times the size for nothing. Additive, so the project
// version stays 5: a reader that does not know `refs` ignores both.
//
// **A window of its own, not a top-bar window.** The top-bar windows (`TopWin`) hang under their
// buttons and one at a time; a reference stays up WHILE you paint and use the others, so it is a
// plain fixed element, dragged by its title bar and resized by its corner.
const RefWin = {
  imgs: [],              // [{ name, type, blob, bmp }], in the order added
  at: -1,                // which one is shown
  keep: false,           // Save with the project
  view: { k: 1, x: 0, y: 0 },   // image px → window px: screen = img * k + (x, y)
  el: null, cv: null,

  // ---- the window ----
  build(){
    if (RefWin.el) return RefWin.el;
    const w = document.createElement("div");
    w.id = "winRef";
    w.style.cssText = "position:fixed; right:24px; top:96px; width:420px; height:340px; min-width:220px; min-height:160px; z-index:115;" +
      " display:none; flex-direction:column; background:var(--panel); border:1px solid var(--border); border-radius:8px;" +
      " box-shadow:0 8px 24px rgba(0,0,0,.45); resize:both; overflow:hidden";
    const head = document.createElement("div");
    head.style.cssText = "display:flex; gap:4px; align-items:center; padding:4px 6px; border-bottom:1px solid var(--border); cursor:move; flex:0 0 auto";
    const title = document.createElement("b");
    title.textContent = "Reference"; title.style.cssText = "font-size:12px; margin-right:2px";
    const pick = document.createElement("select");
    pick.id = "refPick"; pick.style.cssText = "flex:1; min-width:0";
    pick.title = "Which reference image is shown";
    pick.onchange = () => RefWin.show(+pick.value);
    const add = RefWin.button("refAdd", "Add…", "Open images from this computer — photos, colour charts, drawings. Several at once is fine, or drop them onto this window. Nothing is uploaded.", () => RefWin.file().click());
    const del = RefWin.button("refDel", "Remove", "Take the shown image out of the window (and out of the project, if it is saved with it)", () => RefWin.remove(RefWin.at));
    const keep = document.createElement("label");
    keep.title = "Keep these images inside the .wtproj when the project is saved. Off by default — reference photos are often someone else's, and a project you share would carry them.";
    keep.style.cssText = "font-size:11px; white-space:nowrap";
    const kb = document.createElement("input");
    kb.type = "checkbox"; kb.id = "refKeep";
    kb.onchange = () => { RefWin.keep = kb.checked; };
    keep.append(kb, " Save with project");
    const x = RefWin.button("refClose", "✕", "Close the reference window — the images stay until the page is closed", () => RefWin.close());
    head.append(title, pick, add, del, keep, x);
    const cv = document.createElement("canvas");
    cv.id = "refCanvas";
    cv.style.cssText = "flex:1 1 auto; min-height:0; width:100%; display:block; cursor:crosshair; touch-action:none";
    cv.title = "Wheel: zoom · drag: pan · click: take this colour for the brush · double-click: fit";
    const say = document.createElement("div");
    say.id = "refSay"; say.className = "hint";
    say.style.cssText = "margin:0; padding:2px 6px; flex:0 0 auto";
    w.append(head, cv, say);
    document.body.appendChild(w);
    RefWin.el = w; RefWin.cv = cv;
    RefWin.drag(head, w);
    RefWin.pointer(cv);
    new ResizeObserver(() => RefWin.draw()).observe(cv);
    w.addEventListener("dragover", e => e.preventDefault());
    // A drop here is a reference, not a decal. It is NOT stopped: the page's own drop handler
    // (ui/drop.js) has to see it to take its overlay down, and it steps aside for this window.
    w.addEventListener("drop", e => {
      e.preventDefault();
      RefWin.addFiles([...(e.dataTransfer && e.dataTransfer.files || [])]);
    });
    return w;
  },
  button(id, label, title, fn){
    const b = document.createElement("button");
    b.id = id; b.textContent = label; b.title = title; b.onclick = fn;
    b.style.cssText = "padding:1px 6px; font-size:11px";
    return b;
  },
  file(){
    let f = $("refFile");
    if (!f) {
      f = document.createElement("input");
      f.type = "file"; f.id = "refFile"; f.accept = "image/*"; f.multiple = true; f.style.display = "none";
      f.onchange = () => { RefWin.addFiles([...f.files]); f.value = ""; };
      document.body.appendChild(f);
    }
    return f;
  },
  open(){
    RefWin.build().style.display = "flex";
    RefWin.list();
    if (RefWin.at < 0 && RefWin.imgs.length) RefWin.show(0); else RefWin.draw();
    RefWin.said();
  },
  close(){ if (RefWin.el) RefWin.el.style.display = "none"; },
  toggle(){ if (RefWin.el && RefWin.el.style.display !== "none") RefWin.close(); else RefWin.open(); },
  // The title bar moves the window, kept on screen by at least its bar.
  drag(handle, w){
    handle.addEventListener("pointerdown", e => {
      if (e.target !== handle && e.target.tagName !== "B") return;     // the controls in the bar are controls
      const r = w.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      handle.setPointerCapture(e.pointerId);
      const move = ev => {
        w.style.right = "auto";
        w.style.left = Math.max(0, Math.min(innerWidth - 80, ev.clientX - dx)) + "px";
        w.style.top = Math.max(0, Math.min(innerHeight - 30, ev.clientY - dy)) + "px";
      };
      const up = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  },

  // ---- the images ----
  async addFiles(files){
    const ok = files.filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name));
    if (!ok.length) { setStatus("Those are not images — a reference is a PNG, JPEG, WebP, GIF or BMP", "err"); return; }
    let first = -1;
    for (const f of ok) {
      try {
        // The BYTES, copied now. A File is a handle onto the disk: once the photo is edited, moved or
        // deleted there, reading it throws, and a project save or a recovery copy holding it failed
        // whole (review of 4.50 (12), NotReadableError / IndexedDB "InvalidBlob").
        const blob = new Blob([await f.arrayBuffer()], { type: f.type || "" });
        const bmp = await createImageBitmap(blob);
        RefWin.imgs.push({ name: f.name, type: f.type || "", blob, bmp });
        if (first < 0) first = RefWin.imgs.length - 1;
      } catch (e) { reportFailure("Opening “" + f.name + "” as a reference image", e, "ref-open"); }
    }
    if (first < 0) return;
    RefWin.open();
    RefWin.show(first);
    setStatus(ok.length === 1 ? "“" + ok[0].name + "” is in the reference window" : ok.length + " images are in the reference window", "ok");
  },
  remove(i){
    const r = RefWin.imgs[i];
    if (!r) return;
    if (r.bmp.close) r.bmp.close();
    RefWin.imgs.splice(i, 1);
    RefWin.at = -1;
    RefWin.list();
    if (RefWin.imgs.length) RefWin.show(Math.min(i, RefWin.imgs.length - 1)); else RefWin.draw();
    RefWin.said();
  },
  list(){
    const p = $("refPick");
    if (!p) return;
    p.textContent = "";
    RefWin.imgs.forEach((r, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = r.name; p.appendChild(o); });
    p.disabled = !RefWin.imgs.length;
    $("refDel").disabled = !RefWin.imgs.length;
    $("refKeep").checked = RefWin.keep;
    if (RefWin.at >= 0) p.value = String(RefWin.at);
  },
  show(i){
    if (!RefWin.imgs[i]) return;
    RefWin.at = i;
    const p = $("refPick"); if (p) p.value = String(i);
    RefWin.fit();
  },
  said(){
    const s = $("refSay");
    if (s) s.textContent = RefWin.imgs.length ? "Click to take a colour for the brush · wheel to zoom · drag to move"
                                               : "Add a photo or a colour chart to paint from — or drop one here";
  },

  // ---- view: zoom, pan, fit ----
  fit(){
    const r = RefWin.imgs[RefWin.at], cv = RefWin.cv;
    if (!r || !cv) return;
    const W = cv.clientWidth || 1, H = cv.clientHeight || 1;
    const k = Math.min(W / r.bmp.width, H / r.bmp.height);
    RefWin.view = { k, x: (W - r.bmp.width * k) / 2, y: (H - r.bmp.height * k) / 2 };
    RefWin.draw();
  },
  draw(){
    const cv = RefWin.cv;
    if (!cv) return;
    const dpr = devicePixelRatio || 1, W = Math.max(1, Math.round(cv.clientWidth * dpr)), H = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = ctx2d(cv), r = RefWin.imgs[RefWin.at], v = RefWin.view;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#15181d"; g.fillRect(0, 0, W, H);
    if (!r) return;
    // zoomed in past 2× the texels are shown as squares — a colour is read off a photo's pixels
    g.imageSmoothingEnabled = v.k < 2;
    g.setTransform(v.k * dpr, 0, 0, v.k * dpr, v.x * dpr, v.y * dpr);
    g.drawImage(r.bmp, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
  },
  // The image texel under a point of the canvas (CSS px), or null off the image.
  texel(px, py){
    const r = RefWin.imgs[RefWin.at], v = RefWin.view;
    if (!r) return null;
    const x = Math.floor((px - v.x) / v.k), y = Math.floor((py - v.y) / v.k);
    return x >= 0 && y >= 0 && x < r.bmp.width && y < r.bmp.height ? { x, y } : null;
  },
  zoomAt(px, py, f){
    const v = RefWin.view, k = Math.max(.02, Math.min(64, v.k * f)), q = k / v.k;
    RefWin.view = { k, x: px - (px - v.x) * q, y: py - (py - v.y) * q };
    RefWin.draw();
  },
  // The colour of one texel of the shown image, read off the image itself (not the scaled view) —
  // so a pick zoomed out is the same texel's colour as a pick zoomed in.
  colourAt(t){
    const r = RefWin.imgs[RefWin.at];
    const c = mkCanvas(1, 1), g = ctx2d(c);
    g.drawImage(r.bmp, t.x, t.y, 1, 1, 0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return "#" + [d[0], d[1], d[2]].map(n => n.toString(16).padStart(2, "0")).join("");
  },
  pick(px, py){
    const t = RefWin.texel(px, py);
    if (!t) return null;
    const hex = RefWin.colourAt(t);
    Swatches.use(hex);
    setStatus("Picked " + hex + " from “" + RefWin.imgs[RefWin.at].name + "” for the brush — a photo's colour is the light it was taken in, not the paint", "ok");
    return hex;
  },
  // A double-click fits the view, and its two clicks are two motionless presses that each picked:
  // the colour the brush had before the first is put back (review of 4.50 (12)).
  picked: null,
  pointer(cv){
    let down = null;
    cv.addEventListener("wheel", e => {
      e.preventDefault();
      const b = cv.getBoundingClientRect();
      RefWin.zoomAt(e.clientX - b.left, e.clientY - b.top, e.deltaY < 0 ? 1.2 : 1 / 1.2);
    }, { passive: false });
    cv.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;                 // a right or middle press is not a pick or a pan
      cv.setPointerCapture(e.pointerId);
      down = { x: e.clientX, y: e.clientY, vx: RefWin.view.x, vy: RefWin.view.y, moved: false };
    });
    cv.addEventListener("pointermove", e => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) < 3) return;
      down.moved = true;
      RefWin.view.x = down.vx + dx; RefWin.view.y = down.vy + dy;
      RefWin.draw();
    });
    cv.addEventListener("pointerup", e => {
      if (down && !down.moved) {
        const now = performance.now(), b = cv.getBoundingClientRect();
        if (!RefWin.picked || now - RefWin.picked.at > 500) RefWin.picked = { at: now, was: App.brush.color };
        else RefWin.picked.at = now;
        RefWin.pick(e.clientX - b.left, e.clientY - b.top);
      }
      down = null;
    });
    cv.addEventListener("pointercancel", () => { down = null; });
    cv.addEventListener("lostpointercapture", () => { down = null; });
    cv.addEventListener("dblclick", () => {
      if (RefWin.picked && performance.now() - RefWin.picked.at < 600) { Swatches.use(RefWin.picked.was); setStatus("View fitted — the brush colour is as it was", "ok"); }
      RefWin.picked = null;
      RefWin.fit();
    });
  },

  // ---- in the project, only when asked ----
  // Into `meta.refs` and `files`, the way ProjectFile.parts writes everything else.
  save(meta, files){
    if (!RefWin.keep || !RefWin.imgs.length) return;
    meta.refs = RefWin.imgs.map((r, i) => {
      const ext = (/\.([a-z0-9]{2,5})$/i.exec(r.name) || [, "img"])[1].toLowerCase(), f = "refs/r" + i + "." + ext;
      files.push([f, r.blob]);
      return { name: r.name, type: r.type, file: f };
    });
  },
  // …and back. A project without `refs` leaves the window as it is; one with them replaces what
  // the window holds, ticks Save with project, because that is how it was saved, and opens the
  // window, so the images are seen to have come back (and which could not be read is said there).
  async restore(meta, zip){
    // A project saved without them unticks the box: "Save with project" is per project, and a box
    // left ticked from the last one put that project's photos into this one's next save (review of
    // 4.50 (12)). The images already in the window stay there, unticked.
    if (!Array.isArray(meta.refs) || !meta.refs.length) {
      RefWin.keep = false;
      if ($("refKeep")) $("refKeep").checked = false;
      return;
    }
    for (const r of RefWin.imgs) if (r.bmp.close) r.bmp.close();
    RefWin.imgs = []; RefWin.at = -1;
    const lost = [];
    for (const rec of meta.refs) {
      const zf = rec && typeof rec.file === "string" && zip.file(rec.file);
      if (!zf) { lost.push(String(rec && rec.name)); continue; }
      try {
        const blob = new Blob([await zf.async("arraybuffer")], { type: typeof rec.type === "string" ? rec.type : "" });
        RefWin.imgs.push({ name: String(rec.name || rec.file), type: blob.type, blob, bmp: await createImageBitmap(blob) });
      } catch (e) { lost.push(String(rec.name)); reportFailure("Reading the reference image “" + String(rec.name) + "” from the project", e, "ref-restore"); }
    }
    RefWin.keep = true;
    RefWin.open();
    if (RefWin.imgs.length) RefWin.show(0);
    if (lost.length) $("refSay").textContent = "The project named " + lost.length + " reference image(s) it does not hold: " + lost.slice(0, 3).join(", ");
  },
};
