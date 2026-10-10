// Builds a self-contained browser test for the GPU projector and prints its path.
//
// The canvas rasteriser drew one clipped, transformed drawImage PER TRIANGLE. `ctx.clip()` is
// antialiased and almost every edge of a real model is shared between two triangles, so each
// shared edge was two antialiased boundaries that never sum to full coverage — a lattice of
// half-transparent texels through the middle of a marking. The 2.5 % centroid inflate that was
// hiding those seams overhung the true triangle edge in proportion to the triangle (measured on an
// F-111A: p99 10.2 texels, max 76 at 4096), which is the stair-stepped border. And `faceDot < .08`
// was a binary per-triangle verdict, so the silhouette stepped whole triangles at a time.
//
// This runs BOTH rasterisers over the same synthetic patch and asserts the three things that
// distinguish them. A patch is used rather than a vehicle because the defect is a property of the
// rasteriser, not of any model, and the pass/fail thresholds can then be exact.
//
// Usage: node tools/t28_projector.mjs [outfile]
// Then open the printed file in a browser; it prints PASS/FAIL into the page and the console.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/").replace(/\/+$/, "");
const OUT = process.argv[2] || path.join(ROOT, "tools", "_t28_projector.html");
const src = fs.readFileSync(ROOT + "/wt_skin_studio.html", "utf8");

const sectionOf = n => {
  const a = src.indexOf("\n/*==" + n + "==*/"), b = src.indexOf("\n/*==END" + n + "==*/");
  if (a < 0 || b < 0) throw new Error("no " + n + " section");
  return src.slice(a + 1, b);
};
function fn(name) {
  const i = src.indexOf("\nfunction " + name + "(");
  if (i < 0) throw new Error("not found: " + name);
  let d = 0;
  for (let p = src.indexOf("{", i); p < src.length; p++) {
    if (src[p] === "{") d++;
    else if (src[p] === "}") { d--; if (!d) return src.slice(i + 1, p + 1); }
  }
  throw new Error("unbalanced: " + name);
}

const PROJGL = sectionOf("PROJGL");
const CANVASPATH = [fn("drawTexturedTri")].join("\n");

const page = `<!doctype html><meta charset="utf-8"><title>t28 GPU projector</title>
<style>body{background:#14161a;color:#dfe4ea;font:13px/1.5 ui-monospace,Consolas,monospace;padding:16px}
.ok{color:#6ee7a0}.bad{color:#ff8080}.dim{color:#8a8f98}h2{font-size:14px;margin:18px 0 6px}
canvas{border:1px solid #333;margin:6px 8px 0 0;image-rendering:pixelated}</style>
<h2>projector: GPU vs the per-triangle canvas rasteriser</h2><pre id="out"></pre><div id="pics"></div>
<script>
const out = document.getElementById("out");
let bad = 0, checks = 0;
const log = (s, cls) => out.innerHTML += (cls ? "<span class='" + cls + "'>" + s + "</span>" : s) + "\\n";
const say = (ok, m) => { checks++; if (!ok) bad++; log((ok ? "  PASS  " : "  FAIL  ") + m, ok ? "ok" : "bad"); };

// ---- page code under test ----
const mkCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
const ctx2d = c => c.getContext("2d");
const setStatus = (m, k) => log("    [status] " + m, k === "err" ? "bad" : "dim");
const $ = id => ({ checked: false, value: "0" });                    // only optFlipV is read
const App = { _projGL: null, geomData: null, meshes: new Map(), matSlot: new Map(),
  selParts: new Set(), protectedParts: new Set(), modelSize: { x: 10, y: 10, z: 10 } };
function gdBounds(gd){
  if (gd._bb) return gd._bb;
  const pos = gd.position;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] < x0) x0 = pos[i];     if (pos[i] > x1) x1 = pos[i];
    if (pos[i+1] < y0) y0 = pos[i+1]; if (pos[i+1] > y1) y1 = pos[i+1];
    if (pos[i+2] < z0) z0 = pos[i+2]; if (pos[i+2] > z1) z1 = pos[i+2];
  }
  return (gd._bb = { x0, y0, z0, x1, y1, z1 });
}
${PROJGL}
${CANVASPATH}

// ---- a synthetic patch: N x N quads on a gentle cylinder, mapped 1:1 into the sheet ----
// Curved so the facing term actually varies across it, which is what the binary faceDot cut
// used to turn into a staircase.
const SHEET = 512, N = 24, R = 14;
function buildPatch(){
  const pos = [], nrm = [], uv = [];
  const at = (i, j) => {
    const u = i / N, v = j / N;
    const ang = (u - .5) * 1.5;                                    // ±43° of curvature
    return { p: [Math.sin(ang) * R, (v - .5) * 8, Math.cos(ang) * R - R + 4],
             n: [Math.sin(ang), 0, Math.cos(ang)], t: [u, 1 - v] };
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    for (const [x, y, z] of [[a,b,c],[a,c,d]]) for (const q of [x, y, z]) {
      pos.push(q.p[0], q.p[1], q.p[2]); nrm.push(q.n[0], q.n[1], q.n[2]); uv.push(q.t[0], q.t[1]);
    }
  }
  return { name: "patch", mat: "m", position: Float32Array.from(pos),
           normal: Float32Array.from(nrm), uv: Float32Array.from(uv) };
}
App.geomData = [buildPatch()];
App.matSlot.set("m", "s");
const slot = { id: "s" };

// A SOLID opaque decal. Anything less than alpha 255 inside its footprint was invented by the
// rasteriser, not by the image — that is the whole point of the test.
const DEC = mkCanvas(256, 256);
{ const g = ctx2d(DEC); g.fillStyle = "#c42826"; g.fillRect(0, 0, 256, 256); }

const P = { bmp: DEC, scale: 1, rot: 0, flip: false, sym2: false, parts: null,
            depth: PROJ_DEPTH_DEF, wrap: 1 };                      // wrap 1 = reach the silhouette
function projHalfSize(L){
  const halfW = Math.max(.001, L.scale * 10 * .12);
  return { halfW, halfH: halfW * (L.bmp.height / L.bmp.width) };
}
const frame = { p: new THREEVec(0, 0, 4), n: new THREEVec(0, 0, 1), r: new THREEVec(1, 0, 0), u: new THREEVec(0, 1, 0) };
function THREEVec(x, y, z){ this.x = x; this.y = y; this.z = z; }
THREEVec.prototype.clone = function(){ return new THREEVec(this.x, this.y, this.z); };
THREEVec.prototype.multiplyScalar = function(s){ this.x *= s; this.y *= s; this.z *= s; return this; };
THREEVec.prototype.addScaledVector = function(v, s){ this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; };
THREEVec.prototype.negate = function(){ return this.multiplyScalar(-1); };
function projBasis(f, rotDeg, flip){
  const r = rotDeg * Math.PI / 180, c = Math.cos(r), si = Math.sin(r);
  const t1 = f.r.clone().multiplyScalar(c).addScaledVector(f.u, si);
  const t2 = f.u.clone().multiplyScalar(-c).addScaledVector(f.r, si);
  if (flip) t1.negate();
  return { p: f.p.clone(), n: f.n.clone(), t1, t2 };
}
const basis = projBasis(frame, 0, false);
const { halfW, halfH } = projHalfSize(P);

// ---- the OLD path, verbatim in shape: clip + transform + drawImage, per triangle ----
function canvasProject(canvas){
  const g = ctx2d(canvas), w = canvas.width, h = canvas.height;
  const { p, n, t1, t2 } = basis;
  const depthLim = projDepthLim(P, halfW, halfH), faceMin = projFaceBand(P).lo;
  const gd = App.geomData[0], pos = gd.position, uv = gd.uv, nrm = gd.normal;
  const bw = P.bmp.width, bh = P.bmp.height;
  let drawn = 0;
  for (let t = 0; t < pos.length / 9; t++) {
    const o = t * 9, ouv = t * 6;
    let faceDot = 0, dmin = Infinity, dmax = -Infinity, u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    const sx = [0,0,0], sy = [0,0,0];
    for (let k = 0; k < 3; k++) {
      const vx = pos[o+k*3] - p.x, vy = pos[o+k*3+1] - p.y, vz = pos[o+k*3+2] - p.z;
      const d = vx*n.x + vy*n.y + vz*n.z;
      if (d < dmin) dmin = d; if (d > dmax) dmax = d;
      const u = (vx*t1.x + vy*t1.y + vz*t1.z) / (2*halfW) + .5;
      const v = (vx*t2.x + vy*t2.y + vz*t2.z) / (2*halfH) + .5;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
      sx[k] = u*bw; sy[k] = v*bh;
      faceDot += nrm[o+k*3]*n.x + nrm[o+k*3+1]*n.y + nrm[o+k*3+2]*n.z;
    }
    if (u1 < -.15 || u0 > 1.15 || v1 < -.15 || v0 > 1.15) continue;
    const straddles = dmin <= 0 && dmax >= 0;
    if (!straddles && Math.min(Math.abs(dmin), Math.abs(dmax)) > depthLim) continue;
    if (faceDot / 3 < faceMin) continue;
    const dst = [];
    for (let k = 0; k < 3; k++) dst.push([uv[ouv+k*2] * w, (1 - uv[ouv+k*2+1]) * h]);
    drawTexturedTri(g, P.bmp, [[sx[0],sy[0]],[sx[1],sy[1]],[sx[2],sy[2]]], dst);
    drawn++;
  }
  return drawn;
}

// ---- run both ----
const oldC = mkCanvas(SHEET, SHEET);
canvasProject(oldC);

const G = projGL();
if (!G) { log("  no WebGL in this browser — the app falls back to the canvas path, nothing to compare", "bad"); bad++; }
const newC = mkCanvas(SHEET, SHEET);
if (G) {
  G.canvas.width = SHEET; G.canvas.height = SHEET;
  G.gl.viewport(0, 0, SHEET, SHEET);
  projDrawGL(G, P, basis, halfW, halfH, slot, true, 0, SHEET, SHEET);
  projBlit(newC, G.canvas, 0, 0, SHEET, SHEET);   // same call the app makes
}

// ---- measurements ----
function stats(c, label){
  const d = ctx2d(c).getImageData(0, 0, SHEET, SHEET).data;
  let covered = 0, partial = 0, minA = 255;
  // Interior only: 6 texels in from the outermost covered texel, so the decal's own border and
  // the patch's own border are excluded and what is left is pure rasteriser behaviour.
  let x0 = SHEET, x1 = 0, y0 = SHEET, y1 = 0;
  for (let y = 0; y < SHEET; y++) for (let x = 0; x < SHEET; x++) {
    if (d[(y*SHEET+x)*4+3] > 0) { covered++; if (x<x0)x0=x; if (x>x1)x1=x; if (y<y0)y0=y; if (y>y1)y1=y; }
  }
  let inside = 0;
  for (let y = y0+6; y <= y1-6; y++) for (let x = x0+6; x <= x1-6; x++) {
    const A = d[(y*SHEET+x)*4+3];
    inside++;
    if (A < 255) { partial++; if (A < minA) minA = A; }
  }
  log("  " + label + ": " + covered + " texels covered, box " + (x1-x0+1) + "x" + (y1-y0+1) +
      ", interior alpha<255: " + partial + "/" + inside + " (min " + (partial ? minA : 255) + ")", "dim");
  const pic = c.cloneNode(); pic.width = c.width; pic.height = c.height;
  ctx2d(pic).drawImage(c, 0, 0); pic.style.width = "240px"; pic.title = label;
  document.getElementById("pics").appendChild(pic);
  return { covered, partial, inside, minA, box: [x0, y0, x1, y1] };
}
log("");
const so = stats(oldC, "canvas (old)");
const sn = G ? stats(newC, "GPU    (new)") : null;
log("");

// 1. the seam lattice
say(so.partial > so.inside * .02,
  "the old path really does leave the seams this is about: " + so.partial + " interior texels below full alpha " +
  "(" + (100*so.partial/so.inside).toFixed(1) + "% of the marking's interior)");
if (sn) say(sn.partial === 0,
  "GPU leaves NO partly-covered interior texel: " + sn.partial + " (a solid decal must composite solid)");

// 2. the overhang
if (sn) {
  const ow = so.box[2] - so.box[0], nw = sn.box[2] - sn.box[0];
  say(nw <= ow,
    "GPU footprint is not wider than the old one: " + (nw+1) + " vs " + (ow+1) + " texels " +
    "(the 2.5% clip inflate is gone)");
}

// 3. the silhouette is a fade, not a staircase — sample the alpha profile down a column
if (sn) {
  const d = ctx2d(newC).getImageData(0, 0, SHEET, SHEET).data;
  const mid = (sn.box[1] + sn.box[3]) >> 1;
  let steps = 0, prev = -1;
  for (let x = sn.box[0]; x <= sn.box[2]; x++) {
    const A = d[(mid*SHEET+x)*4+3];
    if (prev >= 0 && Math.abs(A - prev) > 200 && A !== 0 && prev !== 0) steps++;
    prev = A;
  }
  say(steps === 0, "no hard alpha cliff across the marking's midline (" + steps + " found) — the wrap fade is per-pixel");
}

// ---- 4. a SEMI-TRANSPARENT decal must composite at the alpha it was authored with ----
// This is the failure that reaches the exported skin. Background removal leaves a decal's edge at
// partial alpha; the old path drew the image once per triangle with a 2.5 % inflated clip, so at
// every shared edge it was composited TWICE. Two draws of alpha a give 1-(1-a)^2, not a — 0.5
// becomes 0.75. Where the decal is opaque that is invisible; where it is semi-transparent the
// layer comes out MORE opaque than authored, so its own colour replaces the blend with the texture
// underneath instead of mixing into it. At 8192 the lattice is one texel wide and sub-pixel on
// screen, which is why it only shows up once the sheet is downscaled on export.
log("");
log("  semi-transparent decal (alpha 128 everywhere) — what background removal leaves:", "dim");
const HALF = mkCanvas(256, 256);
{ const g = ctx2d(HALF); g.fillStyle = "rgba(196,40,38,0.502)"; g.fillRect(0, 0, 256, 256); }
const P2 = Object.assign({}, P, { bmp: HALF });
function alphaProfile(c, label){
  const d = ctx2d(c).getImageData(0, 0, SHEET, SHEET).data;
  let n = 0, over = 0, sum = 0, mx = 0;
  for (let i = 3; i < d.length; i += 4) {
    const A = d[i];
    if (A > 8) { n++; sum += A; if (A > mx) mx = A; if (A > 140) over++; }
  }
  log("    " + label + ": covered " + n + ", mean alpha " + (sum/n).toFixed(1) +
      ", max " + mx + ", texels above 140 (authored is 128): " + over, "dim");
  return { n, mean: sum/n, mx, over };
}
const oldH = mkCanvas(SHEET, SHEET);
{ const savedBmp = P.bmp; P.bmp = HALF; canvasProject(oldH); P.bmp = savedBmp; }
const ao = alphaProfile(oldH, "canvas (old)");
let an = null;
if (G) {
  G.canvas.width = SHEET; G.canvas.height = SHEET; G.gl.viewport(0, 0, SHEET, SHEET);
  projDrawGL(G, P2, basis, halfW, halfH, slot, true, 0, SHEET, SHEET);
  const newH = mkCanvas(SHEET, SHEET);
  projBlit(newH, G.canvas, 0, 0, SHEET, SHEET);
  an = alphaProfile(newH, "GPU    (new)");
}
say(ao.over > 0, "the old path really does push a 50% decal past its authored alpha: " +
  ao.over + " texels above 140, peaking at " + ao.mx + " (two draws of 128 give 191)");
if (an) say(an.mx <= 130 && an.over === 0,
  "GPU keeps a 50% decal at exactly 50%: mean " + an.mean.toFixed(1) + ", max " + an.mx +
  " (authored 128), " + an.over + " texels above 140 — it composites once, so the decal blends " +
  "with the texture under it instead of replacing it");

log("");
log(bad ? "  " + bad + " of " + checks + " checks FAILED" : "  all " + checks + " checks passed", bad ? "bad" : "ok");
console.log(bad ? "FAIL" : "PASS");
</script>`;

fs.writeFileSync(OUT, page);
console.log("wrote " + OUT);
console.log("open it in a browser; it prints PASS/FAIL into the page and the console.");
