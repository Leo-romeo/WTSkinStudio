"use strict";
// ---------- The projected 3-D brush (ROADMAP 1.19 + 1.20 + 4.51; docs/BRUSH_PROJECTION.md) ----------
// A 3-D stroke used to be a 2-D stroke in disguise: each pointer move was raycast to a surface point,
// that point's UV became a texel, and a disc of `App.brush.size` TEXELS was laid there (`stamp3d`). So
// paint went where the UV island went, not where the model went — round a leading edge onto the side
// the camera cannot see, further than the ring on a stretched island (1.20), and never past a seam the
// centre had not crossed, which cut every dab at a part line (1.19, 4.51).
//
// Here the dabs are placed as the 2-D brush places them — `Pen.walk` and `Pen.dab`, unchanged — but on
// the SCREEN, and each one is a footprint seen from the camera: the GPU draws the candidate triangles
// in UV space and every texel asks how much of each dab covers its own point on the model, behind a
// depth and a facing gate (`ProjBrushGL.fs`). Nothing follows the surface, so there is no raycast per
// sub-step and no seam logic; a dab covers whatever is under it. Its size is in METRES — one radius
// for the stroke, fixed at its first hit through that triangle's texel density, which is what the ring
// shows (the owner's answer (1), 2026-10-22) — so a dab further away is smaller on screen, and the walk
// spaces each one by its own size there (`Pen.walk`'s `k`).
//
// On by default since slice (e) (2026-10-24, after the owner's feel check), with its switch and its
// facing limit under the brush's More brush options: the colour brush since slice (a), every coverage
// tool since (b), reach and bleed since (c), the mirror and radial copies since (d). The Clone, Retouch,
// fly mode and a camouflage tile keep `stamp3d`; `refuse` is the one list of what is not projected,
// and `stamp3d` stays whole as the fallback and the switch's other side. The camera cannot
// move during a stroke (orbit is on other buttons), so the view and the depth pre-pass are made once a
// stroke; each part's triangles are found through a grid of its own, made once a part (`grid`).
const ProjBrush = {
  // The facing band, as cosines of the angle between a texel's normal and its way to the camera: none
  // past the limit, full paint up to FADE degrees before it — 85° and 70° by default (the owner's answer
  // (2): a slider under More brush options, at Substance's default once he reads it off his install).
  FADE: 15,
  // A number, or a slider's or a settings file's numeric string, clamped to the slider; anything else
  // (blank, null, a boolean, which `+` would read as 0 and clamp to 45) is the default.
  faceOf(v){
    const n = typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Math.round(+v) : NaN;
    return Number.isFinite(n) ? Math.max(45, Math.min(90, n)) : 85;
  },
  band(){
    const lim = ProjBrush.faceOf(App.brush.face), rad = Math.PI / 180;
    // 90° is cos 0: a surface edge-on to the view; a hair under it, so the band never divides by zero
    return { lo: Math.cos(Math.min(lim, 89.9) * rad), hi: Math.cos((lim - ProjBrush.FADE) * rad) };
  },
  on(){ return !!App.brush.proj3d; },
  // Why this stroke keeps the UV-space brush, or null when it can be projected.
  // Every coverage tool on every channel and on a mask is projected since slice (b); the Clone reads
  // the sheet round each dab, a UV-space question, and keeps `stamp3d` (BRUSH_PROJECTION.md piece 8).
  refuse(t){
    const m = App.brush.mode;
    if (!t || m === "none") return "there is no tool in hand";
    // Retouch sets `stroke.clone` too, so it is named first, and from the brush — `would()` asks before
    // there is a stroke (fix plan 2026-10-23, step 4).
    if (App.brush.tool === "retouch") return "Retouch reads the sheet round each dab, as the Clone does — it paints the old way";
    if (m === "clone" || m === "cloneN" || (stroke && stroke.clone)) return "the Clone copies from the sheet round each dab — it paints the old way";
    // The stroke's camera is fixed from its first dab; flying moves it under the brush.
    if (cam.fly) return "fly mode moves the camera mid-stroke — this stroke paints the old way";
    if (CamoTile.is(App.activeSlot)) return "a camouflage tile is painted on its sheet — this stroke paints the old way";
    return null;
  },
  // Whether a stroke begun now would be projected, as far as the brush can say before it begins — what
  // the 3-D ring's frame follows (`updateBrushRing`), so a Clone or a camouflage tile, which paint on
  // the sheet, are not shown facing the camera (review of 3.41b).
  // And whether this GPU can run it (review of 1.19e): with the brush on by default, a context without
  // what `ProjBrushGL.get` needs would otherwise show the camera-facing ring over a UV-space stroke.
  // Both answers are made once a context and kept, so asking per pointer move costs a lookup.
  would(){ return ProjBrush.on() && !ProjBrush.refuse(true) && ProjBrush.can(); },
  can(){ const G = projGL(); return !!(G && ProjBrushGL.get(G)); },
  // Said once per reason per page, not on every stroke. A tool the brush leaves to the sheet is said
  // as news, not as an error, now that the brush is on for everyone (1.19 (e)): nothing failed when a
  // Clone stroke paints the way it always did. A GPU that cannot run it is an error.
  said: new Set(),
  say(why, cls = "err"){
    if (ProjBrush.said.has(why)) return;
    ProjBrush.said.add(why);
    setStatus("Projected brush: " + why, cls);
  },
  // Take the stroke that `beginStroke` has just begun, at the press `e` whose hit is `hit`. False when
  // it stays a UV-space stroke, having said why if the switch is on. `from`, a point on the model,
  // makes it a Shift+click line from there.
  start(e, hit, from){
    if (!ProjBrush.on() || !stroke) return false;
    // A Shift+click line with no point on the model to start from (the last stroke was on the sheet),
    // or one behind the camera, is the old path's: a line on the texture, or a single dab.
    if (e.shiftKey && (!from || ProjBrush.clip(ProjBrush.camera(cnv3.getBoundingClientRect()), from.x, from.y, from.z)[3] <= 1e-6)) return false;
    const why = ProjBrush.refuse(stroke.t);
    const G = why ? null : projGL(), B = G ? ProjBrushGL.get(G) : null;
    if (!B) { ProjBrush.say(why || (G ? G.brushWhy : "this page has no WebGL context") + (why ? "" : " — painting the old way"), why ? "" : "err"); return false; }
    if (stroke.t.height && !ProjBrushGL.height(G, B)) { ProjBrush.say("this GPU cannot add Panel line's height in a float target — it paints the old way"); return false; }
    const t0 = Rec.clock();
    const pj = ProjBrush.setup(G, B, hit);
    Rec.span("prepass", t0);
    if (!pj) return false;
    stroke.pj = pj;
    recStrokeFlag("proj");
    const at = ProjBrush.at(pj, e.clientX, e.clientY, stroke.p);
    if (from) {
      const f = worldToScreen(from), m = ProjBrush.k(pj, at.x, at.y) * App.brush.size / 2 + 2;
      // Started off the view the line is walked only from where it comes into it (by a dab's radius):
      // a start a centimetre in front of the camera's plane projects tens of thousands of pixels away,
      // and at 0.01 m the walk laid 16 000 dabs no one could see (review of 1.19a, 2026-10-23).
      pj.last = ProjBrush.into(ProjBrush.at(pj, f.x, f.y, stroke.p), at, -m, -m, pj.cam.W + m, pj.cam.H + m);
      ProjBrush.walkTo(pj, at, true);
    } else ProjBrush.lay(pj, [at], ProjBrush.heading(pj, at));
    pj.last = pj.last || at;
    ProjBrush.flush();
    return true;
  },
  // Point `a` of segment a → b moved on to where the segment comes into the box x0 … x1, y0 … y1
  // (Liang–Barsky), keeping its pressure; `a` itself when it is inside, `b` when nothing of it is.
  into(a, b, x0, y0, x1, y1){
    const dx = b.x - a.x, dy = b.y - a.y;
    let t0 = 0, t1 = 1;
    for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]]) {
      if (p === 0) { if (q < 0) return b; continue; }
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    }
    return t0 > t1 ? b : t0 > 0 ? { x: a.x + dx * t0, y: a.y + dy * t0, p: a.p } : a;
  },
  // Everything the stroke keeps: the frozen camera, the depth pre-pass, the candidate parts, the tip.
  setup(G, B, hit){
    const t = stroke.t, TW = t.canvas.width, TH = t.canvas.height, sh = App.activeSlot && App.activeSlot.composite;
    // Sized on the SHEET's texels, as the ring is (`updateBrushRing`), so a layer at another resolution
    // still paints what the ring shows.
    const dens = faceTexelDensity(hit, sh ? sh.width : TW, sh ? sh.height : TH);
    if (!dens) return null;                              // a face with no area: nothing to size the brush by
    const r = cnv3.getBoundingClientRect(), cam = ProjBrush.camera(r);
    if (modelGroup) modelGroup.updateMatrixWorld(true);  // a posed part's place is its mesh's (PoseApply), not its arrays'
    const occ = projOccluders(hit.point, Infinity).filter(gd => { const m = App.meshes.get(gd.name); return !(m && m.userData.effect); });
    ProjBrush.range(cam, occ);
    const depth = ProjBrushGL.depth(G, B, cam, occ, gd => ProjBrush.placed(gd).elements);
    if (!depth) { ProjBrush.say("this GPU would not give the brush a depth target — painting the old way"); return null; }
    // Panel line's bump is round whatever the tool's tip row says (Tips.of), and it never samples a tip.
    const height = !!t.height, stamp = brushStamp(), M = height ? 1 : Math.max(stamp.width, stamp.height);
    const tipK = height ? [1, 1] : [M / stamp.width, M / stamp.height], band = ProjBrush.band();
    ProjBrushGL.tip(G, B, stamp);
    // the pattern brush (4.55): its own pass, which lays the lattice's colours by whole cells
    const lat = !height && Pen.cells(App.brush) ? ProjBrush.lattice() : null, P = height ? B.height : lat ? ProjBrushGL.lattice(G, B) : B;
    if (lat && !P) return null;
    ProjBrushGL.setup(G, B, cam, tipK, band, P);
    if (lat) ProjBrushGL.latSetup(G, P, lat, stamp);
    const pj = { G, B, P, lat, cam, r, depth, dens, TW, TH, band,
      // how far a turned tip reaches past its radius: the half-diagonal of its box over its longer side.
      // A tip that never turns (the Round, Panel line's bump) stays inside its square of side 2r — the
      // box the windows are clipped to (`clipUV`), so √2 there drew and snapshot twice the area (1.19 (e)).
      ext: height || !Tips.get(App.brush.tip).turns ? 1 : Math.hypot(stamp.width, stamp.height) / M, turns: !height && Tips.get(App.brush.tip).turns,
      // what each dab lays: the ink the stamp would have, or for Panel line the depth embossInto takes
      height, col: ProjBrush.rgb(brushStamp.ink(App.brush)), deep: (App.brush.value - 128) / 128 * 26 * App.brush.opacity, z: ProjBrush.depthAt(cam, depth, ...ProjBrush.toView(cam, r, ...ProjBrush.screenOf(hit.point))),
      last: null, head: null, pending: [], dabs: new Float32Array(B.K * 16), slope: [0, 0], idx: new Uint32Array(3 << 12), world: hit.point.clone() };
    if (pj.z == null) pj.z = ProjBrush.viewDepth(cam, hit.point);
    pj.copies = ProjBrush.copies();
    pj.cands = ProjBrush.parts(pj);
    pj.cover = ProjBrush.cover(TW, TH);
    return pj;
  },
  // The active slot's islands at the target's size, by the dab pass's own fill rule (the bleed's "is this
  // texel gutter?"): ONE mask, kept while the slot, the model, the flip and the size stay, and drawn a
  // tile at a time as strokes first reach it (`covered`). Drawn whole at stroke start it cost 200–270 ms
  // at 4096² and 40 at 1024² (software GL, 2026-10-23) — a hitch on every first stroke on a sheet.
  COVER_T: 256,
  cover(W, H){
    const s = App.activeSlot, gd = App.geomData, flip = $("optFlipV").checked, c = ProjBrush._cover;
    // and the parts bound to the slot: Parts ▸ bind… changes that without a new model, and a mask
    // drawn before it called the newly bound part's islands gutter (review of 1.19c)
    const bound = (gd || []).filter(g => App.matSlot.get(g.mat) === (s && s.id)).map(g => g.name).join("\n");
    if (c && c.slot.deref() === s && c.geom.deref() === gd && c.bound === bound && c.flip === flip && c.W === W && c.H === H) return c;
    // held weakly, so a vehicle switch does not keep the old model alive in here; the mask itself is one
    // byte a texel and there is one of it, as heightBuffer keeps one float a texel
    const nx = Math.ceil(W / ProjBrush.COVER_T);
    return (ProjBrush._cover = { slot: new WeakRef(s), geom: new WeakRef(gd || ProjBrush), bound, flip, W, H, nx, mask: new Uint8Array(W * H), done: new Uint8Array(nx * Math.ceil(H / ProjBrush.COVER_T)) });
  },
  _cover: null,
  // Draws the coverage's tiles under window `r`, and the bleed's reach round it, that are not drawn yet —
  // all of them in one pass over the slot's parts, before the window's dab pass clears the buffer.
  covered(pj, r){
    const c = pj.cover, T = ProjBrush.COVER_T, g = ProjBrushGL.BLEED, ny = c.done.length / c.nx;
    const tx0 = Math.max(0, Math.floor((r.x - g) / T)), tx1 = Math.min(c.nx - 1, Math.floor((r.x + r.w - 1 + g) / T));
    const ty0 = Math.max(0, Math.floor((r.y - g) / T)), ty1 = Math.min(ny - 1, Math.floor((r.y + r.h - 1 + g) / T));
    let a = Infinity, b = -1, e = Infinity, f = -1;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++)
      if (!c.done[ty * c.nx + tx]) { a = Math.min(a, tx); b = Math.max(b, tx); e = Math.min(e, ty); f = Math.max(f, ty); }
    if (b < 0) return;
    for (let ty = e; ty <= f; ty++) for (let tx = a; tx <= b; tx++) c.done[ty * c.nx + tx] = 1;
    const t0 = Rec.clock(), s = App.activeSlot;
    const gds = (App.geomData || []).filter(gd => App.matSlot.get(gd.mat) === s.id && gd.uv && gd.position && gd.normal);
    ProjBrushGL.cover(pj.G, pj.B, gds, c.W, c.H, rectClamp({ x: a * T, y: e * T, w: (b - a + 1) * T, h: (f - e + 1) * T }, c.W, c.H), c.mask);
    Rec.span("cover", t0);
  },
  // The camera as it is now, kept for the stroke: its view-projection (column-major, for the shader
  // and for projecting vertices here), its position, and the focal length in CSS px of the 3-D view,
  // whose size is rounded to whole pixels — the size the pre-pass is rendered at.
  camera(r){
    syncCamera();
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
    const VP = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const P = camera.projectionMatrix.elements, pos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    return { W, H, vp: new Float32Array(VP.elements), e: VP.elements.slice(), px: P[0], py: P[5], f: P[5] * H / 2,
             pos: pos.toArray(), world: camera.matrixWorld.clone(), z0: .05, z1: 500 };
  },
  // The depth range the pre-pass packs into: the view depths of the occluders' bounding box corners,
  // with a margin. Linear and that tight, 16 bits of depth test are a third of a millimetre on a 20 m
  // airframe; over the camera's own perspective range they were centimetres.
  range(cam, groups){
    let z0 = Infinity, z1 = -Infinity;
    for (const gd of groups) {
      const b = gdBounds(gd), M = ProjBrush.placed(gd).elements;
      for (let i = 0; i < 8; i++) {
        const w = ProjBrush.clip(cam, ...ProjBrush.xf(M, i & 1 ? b.x1 : b.x0, i & 2 ? b.y1 : b.y0, i & 4 ? b.z1 : b.z0))[3];
        if (w < z0) z0 = w; if (w > z1) z1 = w;
      }
    }
    if (!(z1 > z0)) { z0 = .05; z1 = 500; }
    const m = (z1 - z0) * .02 + 1e-3;
    cam.z0 = Math.max(1e-3, z0 - m); cam.z1 = z1 + m;
  },
  clip(cam, x, y, z){
    const e = cam.e;
    return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], 0, e[3] * x + e[7] * y + e[11] * z + e[15]];
  },
  viewDepth(cam, p){ return ProjBrush.clip(cam, p.x, p.y, p.z)[3]; },
  screenOf(p){ const s = worldToScreen(p); return [s.x, s.y]; },
  // Client px → the pre-pass's own whole-pixel space, which is what the shader's `uView` measures in.
  toView(cam, r, cx, cy){ return [(cx - r.left) * cam.W / r.width, (cy - r.top) * cam.H / r.height]; },
  at(pj, cx, cy, p){ const v = ProjBrush.toView(pj.cam, pj.r, cx, cy); return { x: v[0], y: v[1], p }; },
  // The view depth of the first surface at (x, y), from the CPU copy of the pre-pass, or null where
  // the camera sees nothing. GL's rows run bottom-up.
  depthAt(cam, d, x, y){
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= cam.W || iy >= cam.H) return null;
    const i = ((cam.H - 1 - iy) * cam.W + ix) * 4;
    const v = (d[i] + d[i + 1] / 255 + d[i + 2] / 65025 + d[i + 3] / 16581375) / 255;
    return v > 1 ? null : cam.z0 + v * (cam.z1 - cam.z0);
  },
  // The point of the model under client (cx, cy), by the stroke's pre-pass — where the brush ring is
  // drawn during a projected stroke (`updateBrushRing`), a lookup where a raycast costs 13 ms a move —
  // or, off the model, at the depth the stroke last had.
  under(pj, cx, cy){
    const [x, y] = ProjBrush.toView(pj.cam, pj.r, cx, cy), z = ProjBrush.depthAt(pj.cam, pj.depth, x, y);
    return ProjBrush.unproject(pj.cam, x, y, z == null ? pj.z : z);
  },
  // The point of the model at view (x, y) and view depth z.
  unproject(cam, x, y, z){
    const nx = 2 * x / cam.W - 1, ny = 1 - 2 * y / cam.H;
    return new THREE.Vector3(nx / cam.px * z, ny / cam.py * z, -z).applyMatrix4(cam.world);
  },
  // A CSS colour as brushStamp.ink gives it — #rrggbb or rgb(r,g,b) — in 0–1.
  rgb(css){
    const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(String(css));
    if (m) return [m[1] / 255, m[2] / 255, m[3] / 255];
    const n = parseInt(String(css).replace("#", ""), 16) || 0;
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  },
  // Where a part is: its mesh's world matrix — the identity, unless the pose rig has moved it (a
  // lowered flap, a gear leg, a turned turret: `PoseApply` sets the mesh's matrix and leaves the arrays
  // at rest). Measured before this was read (review, 2026-10-23): a plate moved 0.9 m that way took no
  // projected paint at all, where the UV-space brush, raycasting the posed mesh, laid 1 264 texels.
  _I4: new THREE.Matrix4(),
  placed(gd){ const m = App.meshes && App.meshes.get(gd.name); return m ? m.matrixWorld : ProjBrush._I4; },
  // The stroke's copies (slice (d)) in `paint3dStrokeTo`'s order — the stroke itself, its mirror, each
  // radial turn and that turn's mirror — each as the transform taking a point of the COPY back onto the
  // stroke's own (a Matrix4, null for the stroke itself). A copy is the same dabs seen from the
  // mirrored or turned camera, and a point P of it is painted as the stroke would paint T⁻¹P: so each
  // copy is drawn with that transform on every fragment's point and normal (`uXf`, `uXn`) and needs no
  // camera, pre-pass or depth of its own. On a model symmetric about the plane or the axis — which is
  // what Symmetry and Radial are for — that is exactly what a pre-pass per copy would see.
  copies(){
    const out = [null], n = radialCount();
    let M = null;
    if (symEnabled()) {
      const { a, c } = symPlane(), k = { x: 0, y: 1, z: 2 }[a], sc = [1, 1, 1], at = [0, 0, 0];
      sc[k] = -1; at[k] = 2 * c;
      M = new THREE.Matrix4().makeScale(sc[0], sc[1], sc[2]).setPosition(at[0], at[1], at[2]);
      out.push(M);
    }
    for (let k = 1; k < n; k++) {
      const R = App.radial, c = R.c;
      // turned BACK by copy k's step about the axis through the centre — Radial.rotate's sense
      const back = new THREE.Matrix4().makeTranslation(c[0], c[1], c[2])
        .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(R.dir[0], R.dir[1], R.dir[2]), -Radial.step(n, k)))
        .multiply(new THREE.Matrix4().makeTranslation(-c[0], -c[1], -c[2]));
      out.push(back);
      if (M) out.push(back.clone().multiply(M));         // the turn's mirror: (M R)⁻¹ = R⁻¹ M, M being its own inverse
    }
    return out;
  },
  // Point (x, y, z) through column-major transform `m` (null: as it is).
  xf(m, x, y, z){
    return m ? [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]] : [x, y, z];
  },
  // The parts a dab may land on — `paintTargets`' rules: the active sheet, visible, selected if
  // anything is, never protected — once per copy, each with the one transform its fragments are drawn
  // through: the copy's, after the part's own place (`placed`). `xf` takes the part's arrays to the
  // stroke's world, `xn` is its normal matrix, `inv` takes the stroke's world back to the arrays (a dab's
  // reach is looked up in the part's grid through it), and `wb` is the part's box in the stroke's world.
  parts(pj){
    const names = new Set(paintTargets().map(m => m.name)), out = [], flip = $("optFlipV").checked;
    for (const m of pj.copies) for (const gd of App.geomData || []) {
      if (!names.has(gd.name) || !gd.uv || !gd.normal || !gd.position) continue;
      const X = (m ? m.clone() : new THREE.Matrix4()).multiply(ProjBrush.placed(gd)), xf = new Float32Array(X.elements);
      const b = gdBounds(gd), wb = ProjBrush.boxOf(xf, b);
      out.push({ gd, xf, xn: new Float32Array(new THREE.Matrix3().getNormalMatrix(X).elements), inv: new Float32Array(X.clone().invert().elements),
                 wb, tiles: projUVTiles(gd, flip) });
    }
    return out;
  },
  // Box `b` ({x0 … z1}) through transform `m`: the box round its eight corners there.
  boxOf(m, b){
    const o = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
    for (let i = 0; i < 8; i++) {
      const [x, y, z] = ProjBrush.xf(m, i & 1 ? b.x1 : b.x0, i & 2 ? b.y1 : b.y0, i & 4 ? b.z1 : b.z0);
      if (x < o.x0) o.x0 = x; if (x > o.x1) o.x1 = x; if (y < o.y0) o.y0 = y; if (y > o.y1) o.y1 = y; if (z < o.z0) o.z0 = z; if (z > o.z1) o.z1 = z;
    }
    return o;
  },
  meets(a, b){ return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1 && a.z0 <= b.z1 && b.z0 <= a.z1; },
  // A part's triangles in a uniform grid over its own box, in its own arrays' space — so the camera, the
  // pose and every copy look triangles up in the same grid through their own transforms, and it is made
  // once a part, the first time a stroke reaches it, and kept as long as the geometry is. It replaced
  // screen buckets made per copy per stroke: 117 ms for a 320 000-triangle part each stroke, and 1.3 s
  // with Radial 8 and the mirror's 16 copies (software GL, review of 2026-10-23). About four triangles a
  // cell, at most 64 cells an axis; a flat part is one cell thick.
  _grids: new WeakMap(),
  grid(gd){
    let g = ProjBrush._grids.get(gd);
    if (g) return g;
    const t0 = Rec.clock(), P = gd.position, nt = P.length / 9 | 0, b = gdBounds(gd);
    const o = [b.x0, b.y0, b.z0], ex = [b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0], big = Math.max(ex[0], ex[1], ex[2], 1e-9);
    const s = Math.cbrt(ex.reduce((v, e) => v * Math.max(e, big / 64), 1) / Math.max(1, nt / 4));
    const n = ex.map(e => Math.max(1, Math.min(64, Math.ceil(e / s)))), k = ex.map((e, i) => n[i] / Math.max(e, 1e-12));
    const cell = (v, i) => Math.min(n[i] - 1, Math.max(0, Math.floor((v - o[i]) * k[i])));
    const box = new Int32Array(nt * 6), cnt = new Int32Array(n[0] * n[1] * n[2] + 1);
    for (let t = 0; t < nt; t++) {
      const a = 9 * t, q = 6 * t;
      for (let i = 0; i < 3; i++) {
        const v0 = P[a + i], v1 = P[a + 3 + i], v2 = P[a + 6 + i];
        box[q + i] = cell(Math.min(v0, v1, v2), i); box[q + 3 + i] = cell(Math.max(v0, v1, v2), i);
      }
      for (let z = box[q + 2]; z <= box[q + 5]; z++) for (let y = box[q + 1]; y <= box[q + 4]; y++) for (let x = box[q]; x <= box[q + 3]; x++) cnt[(z * n[1] + y) * n[0] + x + 1]++;
    }
    for (let i = 1; i < cnt.length; i++) cnt[i] += cnt[i - 1];
    const list = new Int32Array(cnt[cnt.length - 1]), fill = cnt.slice(0, cnt.length - 1);
    for (let t = 0; t < nt; t++) {
      const q = 6 * t;
      for (let z = box[q + 2]; z <= box[q + 5]; z++) for (let y = box[q + 1]; y <= box[q + 4]; y++) for (let x = box[q]; x <= box[q + 3]; x++) list[fill[(z * n[1] + y) * n[0] + x]++] = t;
    }
    g = { o, k, n, cell, off: cnt, list, seen: new Uint32Array(nt), mark: 0 };
    ProjBrush._grids.set(gd, g);
    ProjBrush.gridsMade++;
    Rec.span("grid", t0);
    return g;
  },
  gridsMade: 0,
  // A mark no query of grid `g` has used yet, for `query`'s once-per-triangle test. The grid outlives
  // the stroke, and so do its marks: until 2026-10-24 the mark was the STROKE's counter, which starts
  // at 1 again on every stroke, so the first part a stroke queried was queried under the mark the last
  // stroke had left on it and every triangle that stroke had visited was skipped as already seen. On
  // the owner's f_111f a click beside the last one painted only a sliver of the flap the last one had
  // not reached, and a click on the same spot painted nothing (his feel check; t165).
  mark(g){
    g.mark = (g.mark + 1) >>> 0;
    if (!g.mark) { g.seen.fill(0); g.mark = 1; }     // after 2^32 queries: start the marks again from clean
    return g.mark;
  },
  // Every triangle of grid `g` filed in a cell box `b` ({x0 … z1}, in the part's own space) meets, once
  // per `id` (a fresh `mark`), to `fn`.
  query(g, b, id, fn){
    const x0 = g.cell(b.x0, 0), x1 = g.cell(b.x1, 0), y0 = g.cell(b.y0, 1), y1 = g.cell(b.y1, 1), z0 = g.cell(b.z0, 2), z1 = g.cell(b.z1, 2);
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = (z * g.n[1] + y) * g.n[0] + x;
      for (let i = g.off[c], i1 = g.off[c + 1]; i < i1; i++) { const t = g.list[i]; if (g.seen[t] !== id) { g.seen[t] = id; fn(t); } }
    }
  },
  // The part of the world a dab can paint, as a box in the stroke's world: its screen box (its radius,
  // a turned tip's corners, 2 px) between the depths its reach allows — the plane at its centre, ± REACH
  // radii, at the box's corners — within the depth range the pre-pass holds.
  dabBox(pj, d){
    const cam = pj.cam, e = d.r * pj.ext + d.cell + 2, xs = [d.x - e, d.x + e], ys = [d.y - e, d.y + e];
    let lo = cam.z0, hi = cam.z1;
    if (Number.isFinite(ProjBrush.REACH)) {
      lo = hi = d.z;
      for (const x of xs) for (const y of ys) {
        const iz = 1 / d.z + d.h[0] * (x - d.x) + d.h[1] * (y - d.y), z = iz > 1e-9 ? 1 / iz : cam.z1;
        if (z < lo) lo = z; if (z > hi) hi = z;
      }
      lo = Math.max(cam.z0, lo - ProjBrush.REACH * d.R); hi = Math.min(cam.z1, hi + ProjBrush.REACH * d.R);
    }
    const o = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
    for (const x of xs) for (const y of ys) for (const z of [lo, hi]) {
      const p = ProjBrush.unproject(cam, x, y, z);
      if (p.x < o.x0) o.x0 = p.x; if (p.x > o.x1) o.x1 = p.x; if (p.y < o.y0) o.y0 = p.y; if (p.y > o.y1) o.y1 = p.y; if (p.z < o.z0) o.z0 = p.z; if (p.z > o.z1) o.z1 = p.z;
    }
    return o;
  },
  // Does triangle t of candidate c face the camera at any corner, as the shader's facing band asks of
  // its fragments? Facing away at all three, no fragment of it passes — and taken, it would widen the
  // frame's box to an island across the sheet: a part's far side made a 335-texel stroke dirty and
  // snapshot all 64 tiles of a 2048² sheet, 32 MB of undo (review, 2026-10-23).
  faces(pj, c, t){
    const P = c.gd.position, N = c.gd.normal, m = c.xf, q = c.xn, [ex, ey, ez] = pj.cam.pos, lo = pj.band.lo;
    for (let v = 9 * t; v < 9 * t + 9; v += 3) {
      const [x, y, z] = ProjBrush.xf(m, P[v], P[v + 1], P[v + 2]);
      const nx = q[0] * N[v] + q[3] * N[v + 1] + q[6] * N[v + 2], ny = q[1] * N[v] + q[4] * N[v + 1] + q[7] * N[v + 2], nz = q[2] * N[v] + q[5] * N[v + 1] + q[8] * N[v + 2];
      const vx = ex - x, vy = ey - y, vz = ez - z;
      if (nx * vx + ny * vy + nz * vz > lo * Math.hypot(vx, vy, vz) * Math.hypot(nx, ny, nz)) return true;
    }
    return false;
  },
  // The walk's unit at a point: screen px per texel of brush size, at the depth of what is there (or,
  // off the model, at the depth the stroke last had — so a dab hanging over a wing's edge still paints
  // the wing under it).
  k(pj, x, y){
    const z = ProjBrush.depthAt(pj.cam, pj.depth, x, y);
    return pj.cam.f / (pj.dens * (z == null ? pj.z : z));
  },
  heading(pj, q){ return Pen.heading(pj.last, q.x, q.y, null, pj.head); },
  // How far in depth a dab reaches, in its radii: the owner's answer (3), decided without him — on, with
  // no control. `Infinity` turns it off.
  REACH: 1.5,
  // The slope of the surface's inverse depth on screen at (x, y), per CSS px, from the pre-pass: each
  // axis from whichever one-sided difference over a quarter of the dab is SMALLER, so a dab whose centre
  // is near a silhouette takes its own surface's slope, not the jump to what lies behind it. 1/z, because
  // that is what varies linearly across a plane seen in perspective.
  slope(pj, x, y, z, r){
    const st = Math.max(1, Math.min(8, Math.round(r / 4))), iz = 1 / z, cam = pj.cam, D = pj.depth;
    const one = (dx, dy) => { const zz = ProjBrush.depthAt(cam, D, x + dx, y + dy); return zz == null ? null : (1 / zz - iz) / st * Math.sign(dx + dy); };
    const pick = (a, b) => a == null ? (b == null ? 0 : b) : b == null ? a : Math.abs(a) <= Math.abs(b) ? a : b;
    return [pick(one(st, 0), one(-st, 0)), pick(one(0, st), one(0, -st))];
  },
  // One pointer move's samples (client px, with their pressure): walked from the last dab, a dab at
  // each step, queued for the next frame.
  to(pts){
    const pj = stroke && stroke.pj;
    recStrokeCount("moves");
    if (!pj || !pts.length) return;
    for (const s of pts) ProjBrush.walkTo(pj, ProjBrush.at(pj, s.x, s.y, s.p), false);
    ProjBrush.schedule();
  },
  walkTo(pj, q, line){
    const pts = Pen.walk(pj.last, q.x, q.y, q.p, App.brush, line, (x, y) => ProjBrush.k(pj, x, y));
    const head = pj.head = ProjBrush.heading(pj, q);
    if (!pts.length) return;
    ProjBrush.lay(pj, pts, head);
    pj.last = pts[pts.length - 1];
  },
  // The dabs at walk points `pts`: everything `Pen.dab` decides, read in texels and carried onto the
  // screen at each point's own scale; the radius in metres becomes a screen radius at the depth of
  // where the dab actually lands, after scatter.
  //
  // Colour along (4.56) is the 2-D brush's rule: the run is measured between WALK points from the
  // stroke's previous one (`pj.last`, null at its start), in texels — a screen step over that point's
  // px per texel — so a cycle is `cycleLen` brush sizes long in both brushes. Copies (Symmetry, Radial)
  // repeat a queued dab, so they take its colour. Each lane of the cloud run left this to the other
  // (fix plan 2026-10-23, step 3).
  lay(pj, pts, head){
    const b = App.brush, rnd = Pen.dynamic(b) ? Pen.stream(stroke, 0) : null, cam = pj.cam;
    const lut = Pen.cycles(b) && b.cycle !== "hue" ? Gradient.holoLut(b.cycle) : null, runs = stroke.runs || (stroke.runs = []);
    let prev = pj.last;
    recStrokeCount("stamps", pts.length);
    for (const q of pts) {
      const k = ProjBrush.k(pj, q.x, q.y), d = Pen.dab(b, q, head, rnd);
      if (prev) runs[0] = (runs[0] || 0) + Math.hypot(q.x - prev.x, q.y - prev.y) / k;
      prev = q;
      const tint = Pen.ink(b, runs[0] || 0, lut);
      const x = q.x + (d.x - q.x) * k, y = q.y + (d.y - q.y) * k;
      const zc = ProjBrush.depthAt(cam, pj.depth, x, y);
      if (zc != null) { pj.z = zc; pj.world = ProjBrush.unproject(cam, x, y, zc); pj.slope = ProjBrush.slope(pj, x, y, zc, Math.max(.5, d.size / 2 * k)); }
      const R = d.size / 2 / pj.dens, z = zc == null ? pj.z : zc, turn = pj.turns ? d.angle : 0;
      // A dab with a colour of its own (4.56's colour along the stroke) lays it; any other the stroke's ink.
      pj.pending.push({ x, y, r: Math.max(.5, R * cam.f / z), z, R, c: Math.cos(turn), s: Math.sin(turn), h: pj.slope,
        // how far past the dab a cell it reveals can run on the screen: at the nearest depth the dab's
        // reach lets paint land, half as much again for a cell tilted against the view (review, 2026-10-25:
        // measured at the dab's own depth, a near surface's cell could be clipped by the window)
        cell: pj.lat ? pj.lat.reach * 1.5 * cam.f / Math.max(z * .5, z - ProjBrush.REACH * R) + 1 : 0,
        // Panel line's depth by its size: a groove's is negative, and MAX against the cleared target
        // would keep 0 over it; its sign is the stroke's, put back as the field is read (`field`).
        a: (pj.height ? Math.abs(pj.deep) : stroke.dep.dab) * d.flow, col: tint ? [tint[0] / 255, tint[1] / 255, tint[2] / 255] : pj.col });
    }
  },
  schedule(){
    const pj = stroke && stroke.pj;
    if (!pj || pj.sched) return;
    pj.sched = true;
    requestAnimationFrame(() => { pj.sched = false; if (stroke && stroke.pj === pj) ProjBrush.flush(); });
  },
  // Everything queued, a batch of at most K dabs at a time, then the view.
  flush(){
    const pj = stroke && stroke.pj;
    if (!pj || !pj.pending.length) return;
    while (pj.pending.length) ProjBrush.batch(pj, pj.pending.splice(0, pj.B.K));
    refreshStrokeView();
  },
  batch(pj, dabs){
    const t0 = Rec.clock(), sel = ProjBrush.select(pj, dabs);
    Rec.span("select", t0);
    if (!sel.n) return;
    const t1 = Rec.clock(), G = pj.G, gl = G.gl, D = pj.dabs;
    D.fill(0);
    dabs.forEach((d, i) => {
      // Panel line's third vec4 carries the dab's radius in metres, not a colour
      const c = pj.height ? [d.R, 0, 0] : d.col;
      D.set([d.x, d.y, 1 / d.r, d.z, d.c, d.s, d.a, ProjBrush.REACH * d.R, c[0], c[1], c[2], 0, d.h[0], d.h[1], d.cell, 0], 16 * i);
    });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pj.B.ibuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, pj.idx.subarray(0, sel.n), gl.DYNAMIC_DRAW);
    ProjWin.fit(G, pj.TW, pj.TH);
    const H = pj.height ? pj.B.height : null;
    for (const cl of ProjBrush.clusters(sel.boxes))
      for (const t of ProjWin.windows(G, pj.TW, pj.TH, cl.rect, H ? H.T : G.tile)) {
        ProjBrush.covered(pj, t);
        ProjBrush.record(t);
        ProjBrushGL.draw(G, pj.B, D, dabs.length, t, pj.TW, pj.TH, cl.parts, pj.P);
        if (H) ProjBrush.field(pj, t);
        else { ProjBrushGL.bleed(G, pj.B, pj.cover.mask, t, pj.TW, pj.TH); ProjBrush.blit(pj, t); }
      }
    Rec.span("gpu", t1);
  },
  // The triangles this batch can reach — those in grid cells some dab's reach box meets, taken into
  // each candidate's own space, facing the camera there, and with some of them on the screen under the
  // batch's dabs — as indices into `pj.idx`, each part's run once per copy, and the sheet boxes the
  // dabs can paint on them per UV tile.
  select(pj, dabs){
    const out = { n: 0, boxes: [] }, boxes = dabs.map(d => ProjBrush.dabBox(pj, d));
    const all = boxes.reduce((u, b) => ({ x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), z0: Math.min(u.z0, b.z0),
      x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1), z1: Math.max(u.z1, b.z1) }));
    for (const c of pj.cands) {
      if (!ProjBrush.meets(c.wb, all)) continue;
      // the screen box of the dabs that can reach this part: its triangles are clipped to it (`clipUV`)
      const sb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      boxes.forEach((b, j) => {
        if (!ProjBrush.meets(c.wb, b)) return;
        const d = dabs[j], e = d.r * pj.ext + d.cell + 2;
        sb.x0 = Math.min(sb.x0, d.x - e); sb.x1 = Math.max(sb.x1, d.x + e); sb.y0 = Math.min(sb.y0, d.y - e); sb.y1 = Math.max(sb.y1, d.y + e);
      });
      const g = ProjBrush.grid(c.gd), id = ProjBrush.mark(g), start = out.n, acc = [];
      for (const b of boxes) {
        if (!ProjBrush.meets(c.wb, b)) continue;
        ProjBrush.query(g, ProjBrush.boxOf(c.inv, b), id, t => {
          if (!ProjBrush.faces(pj, c, t)) return;
          const r = ProjBrush.clipUV(pj, c, t, sb);
          if (!r) return;                                // none of it on the screen under a dab
          ProjBrush.take(pj, out, 3 * t);
          ProjBrush.grow(pj, acc, r);
        });
      }
      if (out.n > start) ProjBrush.boxes(pj, out, { gd: c.gd, off: start, n: out.n - start, xf: c.xf, xn: c.xn }, acc, c.tiles);
    }
    return out;
  },
  take(pj, out, v){
    if (out.n + 3 > pj.idx.length) { const n = new Uint32Array(pj.idx.length * 2); n.set(pj.idx); pj.idx = n; }
    pj.idx[out.n++] = v; pj.idx[out.n++] = v + 1; pj.idx[out.n++] = v + 2;
  },
  // The part of triangle t of candidate c that screen box `s` ({x0, y0, x1, y1}, the pre-pass's px) can
  // paint, as a box in UV ({u0, v0, u1, v1}): the triangle clipped to the box on the screen, its corners
  // taken back to UV through perspective-correct barycentrics — a projective map keeps straight lines,
  // so the clipped polygon's corners bound its image exactly. Null where none of it is in the box; the
  // whole triangle's box where a corner is behind the camera (the GPU clips that one).
  //
  // Why (1.19 (e), the owner's "slow to apply … even slower"): the window a batch draws, snapshots for
  // undo and blits was the UV box of every triangle it chose, whole. A large triangle — a wing panel
  // that is two triangles, a flap a dozen — put its whole island in the window for a dab that covered a
  // corner of it: on the synthetic wing of t165, a size-32 click on a 1 m² two-triangle panel drew,
  // snapshot and blitted the panel's 128² island for a 32² dab.
  clipUV(pj, c, t, s){
    const P = c.gd.position, U = c.gd.uv, m = c.xf, cam = pj.cam, v = 3 * t;
    let poly = [];
    const iw = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const k = 3 * (v + i), [x, y, z] = ProjBrush.xf(m, P[k], P[k + 1], P[k + 2]), q = ProjBrush.clip(cam, x, y, z);
      if (q[3] <= 1e-6) return ProjBrush.uvBox(U, v, [[0, 0, 1, 0, 0], [0, 0, 0, 1, 0], [0, 0, 0, 0, 1]], [1, 1, 1]);
      const p = [(q[0] / q[3] * .5 + .5) * cam.W, (.5 - q[1] / q[3] * .5) * cam.H, 0, 0, 0];
      p[2 + i] = 1;
      poly.push(p);
      iw[i] = 1 / q[3];
    }
    // Sutherland–Hodgman against the box's four sides, carrying the screen barycentrics along
    for (const [a, lim, hi] of [[0, s.x0, false], [0, s.x1, true], [1, s.y0, false], [1, s.y1, true]]) {
      const next = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        const pin = hi ? p[a] <= lim : p[a] >= lim, qin = hi ? q[a] <= lim : q[a] >= lim;
        if (pin) next.push(p);
        if (pin !== qin) { const f = (lim - p[a]) / (q[a] - p[a]); next.push(p.map((pv, j) => pv + (q[j] - pv) * f)); }
      }
      poly = next;
      if (!poly.length) return null;
    }
    return ProjBrush.uvBox(U, v, poly, iw);
  },
  // The UV box of points given by their screen barycentrics in triangle v (`pts`: [x, y, b0, b1, b2]),
  // perspective-corrected by the corners' 1/w (`iw`).
  uvBox(U, v, pts, iw){
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (const p of pts) {
      const w0 = p[2] * iw[0], w1 = p[3] * iw[1], w2 = p[4] * iw[2], k = 1 / (w0 + w1 + w2);
      const u = (w0 * U[2 * v] + w1 * U[2 * v + 2] + w2 * U[2 * v + 4]) * k, w = (w0 * U[2 * v + 1] + w1 * U[2 * v + 3] + w2 * U[2 * v + 5]) * k;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (w < v0) v0 = w; if (w > v1) v1 = w;
    }
    return { u0, v0, u1, v1 };
  },
  // A triangle's clipped UV box into the part's RUNS — boxes in UV within RUN texels of each other — so
  // two islands of one part far apart on the sheet are two boxes, not the sheet between them.
  RUN: 16,
  grow(pj, acc, box){
    const { u0, v0, u1, v1 } = box;
    const mu = ProjBrush.RUN / pj.TW, mv = ProjBrush.RUN / pj.TH;
    for (const r of acc)
      if (u0 <= r.u1 + mu && u1 >= r.u0 - mu && v0 <= r.v1 + mv && v1 >= r.v0 - mv) {
        if (u0 < r.u0) r.u0 = u0; if (u1 > r.u1) r.u1 = u1; if (v0 < r.v0) r.v0 = v0; if (v1 > r.v1) r.v1 = v1;
        return;
      }
    acc.push({ u0, v0, u1, v1 });
  },
  // A part's run, as one sheet box per UV tile its chosen triangles may cross (the decal pass's rule,
  // 4.23(a): a tiled part is drawn once per repeat it spans), one texel padded each way. Sheet row 0 is
  // the top, v = 1, and Flip V turns v over first, as PROJ_VS does.
  boxes(pj, out, part, acc, tiles){
    const flip = $("optFlipV").checked, W = pj.TW, H = pj.TH;
    for (const r of acc) {
      const va = flip ? 1 - r.v1 : r.v0, vb = flip ? 1 - r.v0 : r.v1;
      const [tx0, tx1] = uvTileRange(r.u0, r.u1), [ty0, ty1] = uvTileRange(va, vb);
      for (let ty = Math.max(ty0, tiles.y0); ty <= Math.min(ty1, tiles.y1); ty++)
        for (let tx = Math.max(tx0, tiles.x0); tx <= Math.min(tx1, tiles.x1); tx++) {
          // padded by a texel and the bleed's reach, so the gutter the bleed fills is in the window
          const m = 1 + ProjBrushGL.BLEED;
          const x0 = Math.max(0, Math.floor((r.u0 - tx) * W) - m), x1 = Math.min(W, Math.ceil((r.u1 - tx) * W) + m);
          const y0 = Math.max(0, Math.floor((1 - (vb - ty)) * H) - m), y1 = Math.min(H, Math.ceil((1 - (va - ty)) * H) + m);
          if (x1 <= x0 || y1 <= y0) continue;
          out.boxes.push({ rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, part, tile: [tx, ty] });
        }
    }
  },
  // Boxes that overlap are drawn together, so a texel two parts share is reached in ONE draw and takes
  // MAX of the two; boxes apart stay apart, so two islands at opposite ends of the sheet do not dirty
  // everything between them (BRUSH_PROJECTION.md piece 5).
  clusters(boxes){
    let cl = boxes.map(b => ({ rect: b.rect, items: [b] }));
    for (let merged = true; merged; ) {
      merged = false;
      for (let i = 0; i < cl.length && !merged; i++) for (let j = i + 1; j < cl.length; j++) {
        const a = cl[i].rect, b = cl[j].rect;
        if (a.x >= b.x + b.w || b.x >= a.x + a.w || a.y >= b.y + b.h || b.y >= a.y + a.h) continue;
        cl[i] = { rect: rectUnion(a, b), items: cl[i].items.concat(cl[j].items) };
        cl.splice(j, 1); merged = true; break;
      }
    }
    return cl.map(c => {
      const parts = new Map();
      for (const it of c.items) {
        const p = parts.get(it.part) || { gd: it.part.gd, off: it.part.off, n: it.part.n, xf: it.part.xf, xn: it.part.xn, tiles: [] };
        if (!p.tiles.some(t => t[0] === it.tile[0] && t[1] === it.tile[1])) p.tiles.push(it.tile);
        parts.set(it.part, p);
      }
      return { rect: c.rect, parts: [...parts.values()] };
    });
  },
  // The window's tiles, kept before anything writes them (TileUndo.record's contract).
  record(t){
    for (let ty = Math.floor(t.y / TILE); ty <= Math.floor((t.y + t.h - 1) / TILE); ty++)
      for (let tx = Math.floor(t.x / TILE); tx <= Math.floor((t.x + t.w - 1) / TILE); tx++) stroke.undo.record(tx * TILE, ty * TILE, 0);
    if (stroke.h) heightBuffer.mark({ x: t.x - 1, y: t.y - 1, w: t.w + 2, h: t.h + 2 });
    else strokeBufferDirty(t.x + t.w / 2, t.y + t.h / 2, Math.max(t.w, t.h) / 2 + 1);
  },
  // Panel line: the window's sum, read back from the float target, ADDED into the stroke's height
  // field — a field adds across frames as embossInto's stamps add — where the stroke's fixed stencil
  // shows; refreshHeightView turns the field into the normal layer as it always did. The 2-D brush
  // tests the stencil at a dab's centre; this has every texel's own answer, so it tests each texel.
  field(pj, t){
    const gl = pj.G.gl, H = pj.B.height, buf = H.buf, F = stroke.h, W = pj.TW, md = strokeMaskData();
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const C = pj.cover.mask, g = ProjBrushGL.BLEED;
    for (let y = 0; y < t.h; y++) {
      const row = (t.h - 1 - y) * t.w, py = t.y + y;                       // the target's rows run bottom-up
      for (let x = 0; x < t.w; x++) {
        const px = t.x + x;
        let v = buf[(row + x) * 4];
        // bleed, as the colour pass's fill does it: a gutter texel takes its strongest island neighbour,
        // so a groove has no false wall where its field would otherwise drop to nothing at an island's rim
        if (!v && !C[py * W + px])
          for (let dy = -g; dy <= g; dy++) for (let dx = -g; dx <= g; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= t.w || ny >= t.h || !C[(t.y + ny) * W + t.x + nx]) continue;
            v = Math.max(v, buf[((t.h - 1 - ny) * t.w + nx) * 4]);
          }
        if (!v) continue;
        if (md) { const ix = (px * md.kx) | 0, iy = (py * md.ky) | 0; if (md.a[(iy * md.w + ix) * 4 + 3] < 8) continue; }
        F[py * W + px] += pj.deep < 0 ? -v : v;
      }
    }
  },
  // The frame's result for window `t` onto the stroke buffer, source-over — compositing frame by frame
  // is compositing dab by dab, since source-over is associative — cut first by the stroke's fixed
  // stencil when it has one (a selection, protected parts, the layer's limit, a marquee).
  blit(pj, t){
    const G = pj.G, CH = G.canvas.height, g = ctx2d(stroke.buf);
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.filter = "none";
    if (!stroke.maskCanvas) { g.drawImage(G.canvas, 0, CH - t.h, t.w, t.h, t.x, t.y, t.w, t.h); return; }
    // In pieces of at most CLIP² through the stamp's own scratch, which a window-sized cut would
    // otherwise grow — and keep, shared — to as much as 4096², 64 MB (review of 1.19a).
    const k = strokeMaskScale(), S = ProjBrush.CLIP, c = stampClipBuf(Math.min(S, Math.max(t.w, t.h))), sg = ctx2d(c);
    for (let y = 0; y < t.h; y += S) for (let x = 0; x < t.w; x += S) {
      const w = Math.min(S, t.w - x), h = Math.min(S, t.h - y);
      sg.globalAlpha = 1; sg.globalCompositeOperation = "source-over";
      sg.clearRect(0, 0, w, h);
      sg.drawImage(G.canvas, x, CH - t.h + y, w, h, 0, 0, w, h);
      sg.globalCompositeOperation = "destination-in";
      sg.drawImage(stroke.maskCanvas, (t.x + x) * k.x, (t.y + y) * k.y, w * k.x, h * k.y, 0, 0, w, h);
      sg.globalCompositeOperation = "source-over";
      g.drawImage(c, 0, 0, w, h, t.x + x, t.y + y, w, h);
    }
  },
  CLIP: 512,
  // Putting the stroke down: what is still queued is drawn now, in this task, and the stroke's last
  // point on the model is kept for a Shift+click line, as `stamp3d`'s hits are.
  finish(){
    const pj = stroke && stroke.pj;
    if (!pj) return;
    ProjBrush.flush();
    stroke.hits[0] = { p: pj.world.clone() };
    // There is no last texel on the sheet to continue a 2-D Shift+click line from — the dab landed on
    // the model, on however many islands — so the next one starts afresh rather than from an older one.
    if (App.activeSlot) App.activeSlot._lastPt = null;
  },
  // ---- the pattern brush (ROADMAP 4.55, the brush that reveals whole cells) ----
  // A pattern's cells are laid in model space, so only a projected stroke can reveal them whole and in
  // line across seams; anything that would paint the old way is refused rather than laid as plain dabs
  // of the brush colour. Why a pattern stroke cannot begin now, or null — asked by `beginStroke` before
  // it makes a layer; `projected` is whether the caller is a press on the model.
  cellsWhy(projected){
    if (!projected) return "it reveals the lattice's cells only under a brush stroke on the model — paint with the brush in the 3-D view";
    if (!ProjBrush.on()) return "it needs the Projected 3-D brush (More brush options)";
    const why = ProjBrush.refuse(true);
    if (why) return why.replace(/ — (this stroke )?paints the old way$/, "");
    const G = projGL(), B = G && ProjBrushGL.get(G);
    if (!B) return G ? G.brushWhy : "this page has no WebGL context";
    if (!ProjBrushGL.lattice(G, B)) return G.latWhy || "this GPU cannot run it";
    return null;
  },
  // A pattern stroke the press could not place after all (behind the camera, a face with no area): no
  // paint, and the layer it made for itself taken back, as `StrokeSetup.shield` takes one back.
  drop(e, from){
    const made = stroke && stroke.madeAct;
    stroke = null;
    recStrokeEnd();                                    // begun by StrokeSetup.make; closed with nothing in it
    if (made) { made.undo(); Autosave.moveTo(made.revFrom); }
    setStatus("Pattern brush: " + (e && e.shiftKey && !from ? "Shift+click draws a line from the last stroke on the model — there is none yet"
      : "this press could not be placed on the model") + " — nothing was painted", "err");
  },
  // Made ready while the hand is still on the panel: the pass's program (its link took ~200 ms on the
  // owner's GTX 1660, measured 2026-10-25 — all of it in the first press, which took 234 ms) and the
  // lattice's tile and owners. Idle, once per change of look; a press after it pays neither.
  // Debounced, so a slider dragged through twenty widths makes one owner map, not twenty (review,
  // 2026-10-25).
  warm(){
    clearTimeout(ProjBrush._warm);
    ProjBrush._warm = setTimeout(() => (window.requestIdleCallback || (f => f()))(() => {
      if (!Pen.cells(App.brush) || stroke) return;
      const G = projGL(), B = G && ProjBrushGL.get(G);
      if (B && ProjBrushGL.lattice(G, B)) ProjBrush.lattice();
    }), 300);
  },
  // The stroke's lattice: the tile (a power of two each way, so it repeats and mipmaps), which cells own
  // each of its texels (`Procedural.latticeOwners`), and where it lies on the model. Both are kept while
  // the look stays — the owners are a few tens of milliseconds a shape, made at the first stroke after
  // a change, not on every one.
  LAT_W: 512,
  lattice(){
    const p = Procedural.brushPatClone(App.brush.pattern), C = Procedural.latticeCells(p.kind);
    const W = ProjBrush.LAT_W, H = Procedural.pot(Math.round(W * C.h / C.w)), hw = p.borderOn ? p.width : 0;
    const key = JSON.stringify([p.kind, p.fill, p.border, p.width, p.fillOn, p.borderOn]), okey = p.kind + "/" + hw;
    let c = ProjBrush._lat;
    if (!c || c.key !== key) {
      // the owners at half the tile's size: half an owner texel of slack is one of the tile's, and a quarter
      // of the work (on the owner's machine, 2026-10-25: triangles 83 ms, hexagons 57, against 610 for triangles at full size)
      const own = c && c.okey === okey ? c.own : Procedural.latticeOwners(p.kind, hw, W >> 1, H >> 1);
      c = ProjBrush._lat = { key, okey, own, tile: GradFill.latticeTile(p, W, H), C };
    }
    // the farthest a texel a cell owns lies from the cell's centre, in metres
    return Object.assign({ size: p.size, angle: p.angle, sharp: Procedural.patMake().sharp, reach: c.own.reach * p.size / C.w }, c);
  },
};
