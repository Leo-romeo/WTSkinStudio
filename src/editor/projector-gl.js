/*==PROJGL==*/
// ---- GPU projector ----
// The canvas rasteriser above draws one clipped, transformed drawImage PER TRIANGLE. Measured on
// an F-111A (666 046 triangles, 2026-08-04) that is 233 000–301 000 clip+transform+drawImage calls
// per live-drag frame on the UI thread, and it is wrong in three separate ways:
//
//   * `ctx.clip()` is antialiased, and 865 041 of the model's 915 585 edges are SHARED between two
//     triangles. Two antialiased boundaries never sum to full coverage, so every shared edge left a
//     lattice of half-transparent texels — the grey pixels along a marking's border. This is the
//     same trap `partSetMaskCanvas` documents and dodges by filling one path; a projection cannot,
//     because every triangle needs its own texture transform.
//   * the 2.5 % centroid inflate that was papering over those seams overhangs the true triangle
//     edge by a distance proportional to the triangle: p99 10.2 texels and up to 76 at 4096, 20 and
//     153 at 8192. That is the stair-stepped edge, its step size following the triangulation.
//   * `faceDot < .08` is a BINARY per-triangle cut, and 55 564 triangles straddle it on a side-on
//     aim, so the silhouette was a staircase of whole triangles rather than a fade.
//
// The GPU has an exact fill rule: each texel is covered once, by one triangle, with no antialiasing
// to accumulate (`antialias:false` is load bearing — MSAA would put the seam straight back). The
// projector maths moves to the fragment shader, so facing and depth become smooth per-pixel terms
// instead of per-triangle verdicts, and the whole sheet is one draw call per part group.
//
// Its own WebGL1 context on an offscreen canvas: the result reaches the layer through
// `drawImage`, which is a GPU-side copy, rather than `readRenderTargetPixels` (67 MB at 4096²,
// 268 MB at 8192²) had this shared the viewport's renderer.
const PROJ_VS = `
attribute vec2 aUV; attribute vec3 aPos; attribute vec3 aNrm;
uniform float uFlipV;
uniform vec2 uTile;
uniform vec4 uWin;
varying vec3 vPos; varying vec3 vNrm;
void main(){
  vPos = aPos; vNrm = aNrm;
  float v = uFlipV > .5 ? 1. - aUV.y : aUV.y;
  // uTile slides the whole part by a whole sheet, so a tiled UV (the t55e1 gun barrel runs u to
  // 6.353) is drawn once per repeat instead of once, off the edge (ROADMAP 4.23(a)). NOT fract():
  // folding each vertex independently tears every triangle that straddles a boundary, which is the
  // smear the item warned about. A translation cannot.
  // uWin is the window of the sheet this draw covers, in UV units (x0, y0 from the bottom, w, h),
  // when the sheet is bigger than the drawing buffer (ProjWin, ROADMAP 1.17 (1)). Left at its
  // default of zeros it is the whole sheet, and the arithmetic is exactly the old (x − 0) / 1: the
  // bakes share this shader and never set it.
  vec2 k = uWin.zw + step(uWin.zw, vec2(0.));
  vec2 s = (vec2(aUV.x, v) - uTile - uWin.xy) / k;
  gl_Position = vec4(s * 2. - 1., 0., 1.);
}`;
// Packing a [0,1] depth into RGBA8 — the standard four-byte split. `WEBGL_depth_texture` would
// avoid it, but it is an extension and this needs none: an ordinary RGBA colour target works
// everywhere, and 32 bits over the beam's reach is far finer than any bias worth using.
const PROJ_PACK = `
vec4 packDepth(float v){
  vec4 e = fract(vec4(1., 255., 65025., 16581375.) * v);
  e -= e.yzww * vec4(1. / 255., 1. / 255., 1. / 255., 0.);
  return e;
}
float unpackDepth(vec4 c){ return dot(c, vec4(1., 1. / 255., 1. / 65025., 1. / 16581375.)); }
`;
// ---- the occlusion pre-pass ----
// The projector is a beam with a depth RANGE, and nothing used to stop it painting the second,
// third and fourth surface it passed through. This renders the candidate geometry once from the
// projector's own orthographic view — one texel per RAY of the beam, indexed by the decal's own
// (u,v) — keeping the surface nearest the projector. The main pass then rejects any fragment
// further away than that.
const PROJD_VS = `
attribute vec3 aPos;
uniform vec3 uP, uN, uT1, uT2;
uniform vec2 uHalf;
uniform float uDepth;
varying float vT;
void main(){
  vec3 d = aPos - uP;
  float u = dot(d, uT1) / (2. * uHalf.x) + .5;
  float v = dot(d, uT2) / (2. * uHalf.y) + .5;
  // 0 = the outermost surface the beam can reach, 1 = the deepest. Writing it as clip z means the
  // ordinary depth test keeps the nearest, and anything outside the reach is clipped — the same
  // range the main pass accepts, so the two can never disagree about what is in the beam.
  vT = .5 - dot(d, uN) / (2. * uDepth);
  gl_Position = vec4(u * 2. - 1., v * 2. - 1., vT * 2. - 1., 1.);
}`;
const PROJD_FS = `
precision highp float;
varying float vT;
${PROJ_PACK}
void main(){ gl_FragColor = packDepth(clamp(vT, 0., 1.)); }`;
const PROJ_FS = `
precision highp float;
uniform vec3 uP, uN, uT1, uT2;
uniform vec2 uHalf;
uniform float uDepth, uFaceLo, uFaceHi, uOccOn, uBias;
uniform sampler2D uTex, uOcc;
varying vec3 vPos; varying vec3 vNrm;
${PROJ_PACK}
void main(){
  vec3 d = vPos - uP;
  float u = dot(d, uT1) / (2. * uHalf.x) + .5;
  float v = dot(d, uT2) / (2. * uHalf.y) + .5;
  if (u < 0. || u > 1. || v < 0. || v > 1.) discard;
  // Depth: how far through the vehicle the projector reaches. Without a limit a marking aimed at
  // a fuselage side also lands on the far side, mirrored — the projector is a beam, not a decal.
  float sd = dot(d, uN);
  float dep = abs(sd);
  float da = 1. - smoothstep(uDepth * .82, uDepth, dep);
  if (da <= 0.) discard;
  // Facing, per PIXEL and smooth: this is what replaces the per-triangle staircase.
  float nd = dot(normalize(vNrm), uN);
  float fa = smoothstep(uFaceLo, uFaceHi, nd);
  if (fa <= 0.) discard;
  // Occlusion: only the FIRST surface along this ray is painted. The bias covers the difference
  // between the pre-pass's own rasterisation and this one, and grows as the surface turns away
  // from the projector, where one texel of the depth map spans more depth.
  if (uOccOn > .5) {
    float t = .5 - sd / (2. * uDepth);
    float near = unpackDepth(texture2D(uOcc, vec2(u, v)));
    if (t > near + uBias * (1. + 1.5 * (1. - clamp(nd, 0., 1.)))) discard;
  }
  vec4 c = texture2D(uTex, vec2(u, v));
  float a = c.a * fa * da;
  gl_FragColor = vec4(c.rgb * a, a);            // premultiplied, to match the context
}`;
function projGL(){
  const G = App._projGL;
  if (G) return G.gl ? G : null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 4;
  const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
    stencil: false, preserveDrawingBuffer: false, powerPreference: "high-performance" };
  const gl = canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts);
  if (!gl) { App._projGL = { gl: null }; return null; }
  const sh = (type, srcTxt) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, srcTxt); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("projector shader: " + gl.getShaderInfoLog(s));
    return s;
  };
  const link = (vs, fs, what) => {
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(what + " link: " + gl.getProgramInfoLog(p));
    return p;
  };
  let prog, dprog;
  try {
    prog = link(PROJ_VS, PROJ_FS, "projector");
    dprog = link(PROJD_VS, PROJD_FS, "projector depth");
  } catch (err) {
    // Not silent, and not fatal: the canvas rasteriser below still works, just slowly.
    setStatus("3D projection is falling back to the slower CPU path — " + err.message, "err");
    App._projGL = { gl: null };
    return null;
  }
  gl.useProgram(prog);
  const u = n => gl.getUniformLocation(prog, n);
  const du = n => gl.getUniformLocation(dprog, n);
  const G2 = { gl, canvas, prog, dprog, gen: 1, texBmp: null, tex: null, live: [], bytes: 0, occ: [],
    a: { uv: gl.getAttribLocation(prog, "aUV"), pos: gl.getAttribLocation(prog, "aPos"), nrm: gl.getAttribLocation(prog, "aNrm") },
    da: { pos: gl.getAttribLocation(dprog, "aPos") },
    u: { P: u("uP"), N: u("uN"), T1: u("uT1"), T2: u("uT2"), half: u("uHalf"),
         depth: u("uDepth"), faceLo: u("uFaceLo"), faceHi: u("uFaceHi"), flipV: u("uFlipV"),
         tex: u("uTex"), occ: u("uOcc"), occOn: u("uOccOn"), bias: u("uBias"), tile: u("uTile"), win: u("uWin") },
    dU: { P: du("uP"), N: du("uN"), T1: du("uT1"), T2: du("uT2"), half: du("uHalf"), depth: du("uDepth") },
    maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE), tile: ProjWin.TILE };
  const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  G2.tile = ProjWin.potFloor(Math.min(ProjWin.TILE, G2.maxTex, vp[0], vp[1]));
  // A lost context leaves every cached buffer and texture dangling. Bump the generation so the
  // per-part buffers rebuild, and say so rather than rendering nothing.
  canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); App._projGL = null; setStatus("Graphics context was lost — the projection will rebuild on the next change", "err"); });
  return App._projGL = G2;
}
function projPot(n, max){ let p = 1; while (p < n) p <<= 1; return Math.max(1, Math.min(p, max)); }
// ---- the drawing buffer the context really gives ----
// Chrome caps a WebGL drawing buffer's AREA, whatever MAX_TEXTURE_SIZE and MAX_VIEWPORT_DIMS say,
// and quietly gives a smaller buffer when asked for more. Measured 2026-10-23 in headless Chromium
// 141 (both limits 8192): an 8192² canvas got a 5760² buffer and 8192×4096 got 8145×4072 — about
// 2^25 pixels either way, so a single 8192² sheet already asks for too much. The projector used to
// grow its canvas to the largest sheet seen and read each sheet back from `canvas.height − h`, a row
// the shrunk buffer does not have: after one 8192 sheet every projection on the page drew into one
// corner and came back from another, and clearing the project could not cure it because the context
// outlives the project. That is ROADMAP 1.17 (1), the decals that shifted after a resize to 8192.
//
// So the canvas is never asked for more than `G.tile` on a side, 4096 — the largest power of two
// whose square fits under the cap — and a bigger sheet is drawn one window at a time (`windows`).
// After every resize the buffer is checked against what was asked, and a context that gives less
// halves the window until it gives all of it. Four 4096² windows cost the vertex work four times; a
// buffer that lies costs every decal its place. One object, so the fix adds one name to the scope.
const ProjWin = {
  TILE: 4096,
  potFloor(n){ let p = 1; while (p * 2 <= n) p <<= 1; return p; },
  fit(G, w, h){
    const gl = G.gl;
    for (;;) {
      const cw = Math.min(G.tile, Math.max(G.canvas.width, w)), ch = Math.min(G.tile, Math.max(G.canvas.height, h));
      if (G.canvas.width !== cw) G.canvas.width = cw;        // assigning clears it, even to the same value
      if (G.canvas.height !== ch) G.canvas.height = ch;
      if (gl.drawingBufferWidth >= cw && gl.drawingBufferHeight >= ch) return;
      // A lost context reports a 0×0 buffer; halving cannot fix that, and the next change rebuilds it.
      if (G.tile <= 64 || gl.isContextLost()) return;
      G.tile >>= 1;
    }
  },
  // The windows a w×h sheet is drawn in, in sheet texels, top-down like the sheet itself: one window
  // unless the sheet is bigger than the buffer. `r` limits them to a rectangle of the sheet.
  windows(G, w, h, r, T = G.tile){                // `T`: a smaller window, for a target that is one
    const x0 = r ? Math.max(0, r.x) : 0, y0 = r ? Math.max(0, r.y) : 0;
    const x1 = r ? Math.min(w, r.x + r.w) : w, y1 = r ? Math.min(h, r.y + r.h) : h;
    const out = [];
    for (let y = y0; y < y1; y += T) for (let x = x0; x < x1; x += T)
      out.push({ x, y, w: Math.min(T, x1 - x), h: Math.min(T, y1 - y) });
    return out;
  },
  // Aim the program `P` (the decal pass's, or the brush's) at window `t` of a sw×sh sheet: drawn 1:1
  // into the buffer's bottom-left corner, where an image read starts at row `canvas.height − t.h`.
  // GL's rows run bottom-up, so the window's first sheet row is its TOP: its v range starts
  // (sh − t.y − t.h) / sh from the bottom.
  aim(G, sw, sh, t, P = G){
    const gl = G.gl;
    gl.useProgram(P.prog);
    gl.uniform4f(P.u.win, t.x / sw, (sh - t.y - t.h) / sh, t.w / sw, t.h / sh);
    gl.viewport(0, 0, t.w, t.h);
    gl.enable(gl.SCISSOR_TEST);                    // so the clear costs the window, not the buffer
    gl.scissor(0, 0, t.w, t.h);
  },
};
// The decal as a mipmapped texture. WebGL1 only mipmaps power-of-two dimensions, so the image is
// resampled into the next POT box — the two axes are independent, and the projector keeps the real
// aspect through halfW/halfH, so nothing is distorted. Mips matter: a 4096-px decal landing on a
// 200-texel patch samples 1 texel in 20 without them, which is the ragged sparkling edge
// `decalDraw` already fixes on the 2-D side.
function projTexture(G, bmp){
  if (G.texBmp === bmp && G.tex) return G.tex;
  const gl = G.gl;
  const w = projPot(bmp.width, G.maxTex), h = projPot(bmp.height, G.maxTex);
  let img = bmp;
  if (w !== bmp.width || h !== bmp.height) {
    const c = mkCanvas(w, h), g = ctx2d(c);
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, 0, 0, w, h);
    img = c;
  }
  if (G.tex) gl.deleteTexture(G.tex);
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  // v=0 must be the image's TOP row, to match the 2-D path where `sy = v * bh` indexes into a
  // `drawImage(img,0,0)` whose row 0 is the top. GL's t=0 is the first row UPLOADED, so that means
  // NOT flipping: UNPACK_FLIP_Y_WEBGL puts the bottom row at t=0 and lands the decal mirrored.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  // Straight alpha on the way in: the shader does the premultiply itself, and doing it twice
  // darkens every soft edge of the decal against its own transparency.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  // BROWSER_DEFAULT_WEBGL lets the driver apply a PNG's embedded gamma/sRGB chunk on upload, which
  // a JPEG has no equivalent of — the same artwork saved both ways then projects at two different
  // brightnesses, the PNG the lighter of the two. NONE hands over exactly the bytes the 2-D
  // compositor would have used.
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  G.texBmp = bmp; G.tex = t;
  return t;
}
// Per part-group vertex buffers, cached on the geometry the way `gdBounds` caches its box. Every
// filter the projector applies (material→slot, visibility, part scope, protected) is per GROUP, so
// filtering is choosing which of these to draw; only depth, facing and the image bounds are
// per-triangle, and those are now the shader's job.
// The whole-sheet tile range a part's UVs cross, in the shader's own coordinate — so the V half is
// computed on the FLIPPED v when Flip V is on, or a flipped tiled part would be offset the wrong
// way. Cached on the geometry and keyed by the flip, because the bounds are a property of the mesh
// and this is called per draw.
function projUVTiles(gd, flipV){
  const key = flipV ? "F" : "N";
  if (gd._uvTiles && gd._uvTilesKey === key) return gd._uvTiles;
  const uv = gd.uv;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < uv.length; i += 2) {
    const u = uv[i], v = flipV ? 1 - uv[i + 1] : uv[i + 1];
    if (u < u0) u0 = u; if (u > u1) u1 = u;
    if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  const [x0, x1] = uv.length ? uvTileRange(u0, u1) : [0, 0];
  const [y0, y1] = uv.length ? uvTileRange(v0, v1) : [0, 0];
  gd._uvTiles = { x0, x1, y0, y1 };
  gd._uvTilesKey = key;
  return gd._uvTiles;
}
function projBuffers(G, gd){
  if (gd._glBuf && gd._glGen === G.gen) return gd._glBuf;
  const gl = G.gl;
  const mk = data => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    G.live.push(b); G.bytes += data.byteLength;
    return b;
  };
  const buf = { pos: mk(gd.position), nrm: mk(gd.normal), uv: mk(gd.uv), n: gd.position.length / 3 };
  gd._glBuf = buf; gd._glGen = G.gen;
  return buf;
}
// Loading a second vehicle drops the geometry objects these hang off, but not the driver-side
// buffers. Freeing on every `App.geomData = …` would mean chasing six assignments and missing the
// seventh, so the cap does it: a whole F-111A is ~64 MB of attributes, and past the cap everything
// is released and rebuilt on demand under a new generation.
const PROJ_GL_BUDGET = 384 << 20;
function projGLFree(){
  const G = App._projGL;
  if (!G || !G.gl) return;
  for (const b of G.live) G.gl.deleteBuffer(b);
  G.live = []; G.bytes = 0; G.gen++;
}
// Which part groups this projection touches on this sheet. Shared by the GPU path and by the
// CPU counter, so the two never disagree about scope.
// A posed part is reached in its own frame (`Project.near`, `Project.local`).
function projGroups(L, p, reach, slot){
  const s = slot || App.activeSlot, out = [];
  if (!App.geomData || !s) return out;
  const sel = Scope.parts(L) !== undefined
    ? (Scope.parts(L) ? new Set(Scope.parts(L)) : null)
    : (App.selParts && App.selParts.size ? App.selParts : null);
  for (const gd of App.geomData) {
    if (App.matSlot.get(gd.mat) !== s.id) continue;
    const mesh = App.meshes.get(gd.name);
    if (mesh && !mesh.visible) continue;
    if (sel && !sel.has(gd.name)) continue;
    if (App.protectedParts.has(gd.name)) continue;
    if (!gd.uv || !gd.normal || !gd.position) continue;
    if (!Project.near(gd, p, reach)) continue;
    out.push(gd);
  }
  return out;
}
// ---- What can stand in the beam's way ----
// Deliberately NOT the same set as projGroups. Occlusion is a fact about the geometry, not about
// which sheet is being painted: a fuselage panel has to block an interior part that lives on a
// different texture, and that is exactly why the interior sheets used to fill up. So this ignores
// the material→slot filter and the layer's part scope, and keeps protected parts — "do not paint
// this" does not make a surface transparent.
// Hidden meshes are the one exception: they are not on screen, and hiding the part in front of
// what you want to paint is the way to reach inside a vehicle now that the beam stops at the skin.
function projOccluders(p, reach){
  const out = [];
  if (!App.geomData) return out;
  for (const gd of App.geomData) {
    const mesh = App.meshes.get(gd.name);
    if (mesh && !mesh.visible) continue;
    if (!gd.uv || !gd.normal || !gd.position) continue;
    if (!Project.near(gd, p, reach)) continue;
    out.push(gd);
  }
  return out;
}
// One depth target per basis — slot 0 is the projection, slot 1 its mirrored twin — so a two-sided
// decal does not evict its own map between the two draws, and neither does the next sheet.
const PROJ_OCC_SZ = 1024;
// Measured on the F-111A with a user's own projector (2026-08-05): 11 mm of bias at that reach
// removes the whole failure and 45 mm removes very nearly as much, so this sits far from any edge.
const PROJ_OCC_BIAS = 0.003;
function projOccTarget(G, i){
  if (G.occ[i]) return G.occ[i];
  const gl = G.gl;
  const size = Math.min(PROJ_OCC_SZ, G.maxTex);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  // NEAREST, always: the texels hold a packed 32-bit number, and interpolating the four bytes of
  // two different depths produces a value that is neither of them.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const rb = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) {
    // Say so once rather than silently painting through the vehicle again.
    setStatus("This GPU would not give the projector a depth target — markings may reach surfaces behind the one you aimed at", "err");
    return (G.occ[i] = { bad: true });
  }
  return (G.occ[i] = { fb, tex, rb, size, sig: null });
}
// Render the nearest-surface map for one basis. Returns the texture, or null when the target could
// not be made — the caller then draws with occlusion off, which is the old behaviour.
function projDepthMap(G, basis, halfW, halfH, depthLim, which, vpW, vpH){
  const T = projOccTarget(G, which);
  if (T.bad) return null;
  const gl = G.gl;
  const { p, n, t1, t2 } = basis;
  const groups = projOccluders(p, Math.hypot(halfW, halfH) + depthLim);
  // Skipping an unchanged map is what makes a multi-sheet decal cost one pre-pass rather than one
  // per sheet: the basis and the occluders are identical across a group's sheets.
  let sig = G.gen + "|" + [p.x, p.y, p.z, n.x, n.y, n.z, t1.x, t1.y, t1.z, t2.x, t2.y, t2.z, halfW, halfH, depthLim].join(",");
  for (const gd of groups) { const B = Project.local(gd, basis); sig += "|" + gd.name + (B.posed ? ":" + B.posed.elements.join(",") : ""); }
  if (T.sig === sig) return T.tex;
  gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
  gl.viewport(0, 0, T.size, T.size);
  gl.disable(gl.SCISSOR_TEST);
  gl.disable(gl.BLEND);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.depthMask(true);
  // 1.0 everywhere = "nothing in the beam here", which the main pass reads as no occluder.
  gl.clearColor(1, 1, 1, 1);
  gl.clearDepth(1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(G.dprog);
  gl.uniform3f(G.dU.P, p.x, p.y, p.z);
  gl.uniform3f(G.dU.N, n.x, n.y, n.z);
  gl.uniform3f(G.dU.T1, t1.x, t1.y, t1.z);
  gl.uniform3f(G.dU.T2, t2.x, t2.y, t2.z);
  gl.uniform2f(G.dU.half, halfW, halfH);
  gl.uniform1f(G.dU.depth, depthLim);
  gl.enableVertexAttribArray(G.da.pos);
  for (const gd of groups) {
    const b = projBuffers(G, gd), B = Project.local(gd, basis);
    gl.uniform3f(G.dU.P, B.p.x, B.p.y, B.p.z); gl.uniform3f(G.dU.N, B.n.x, B.n.y, B.n.z);
    gl.uniform3f(G.dU.T1, B.t1.x, B.t1.y, B.t1.z); gl.uniform3f(G.dU.T2, B.t2.x, B.t2.y, B.t2.z);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.pos);
    gl.vertexAttribPointer(G.da.pos, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, b.n);
  }
  gl.disableVertexAttribArray(G.da.pos);
  gl.disable(gl.DEPTH_TEST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, vpW, vpH);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(0, 0, vpW, vpH);
  T.sig = sig;
  return T.tex;
}
// Depth reach and facing band from the decal's own parameters. `depth` is a multiple of the
// image's half-size, so a big marking reaches proportionally deeper; `wrap` runs 0…1 from
// "front faces only" to "right up to the silhouette".
function projDepthLim(P, halfW, halfH){ return Math.max(halfW, halfH) * (P.depth == null ? PROJ_DEPTH_DEF : P.depth); }
function projFaceBand(P){
  const wrap = P.wrap == null ? PROJ_WRAP_DEF : P.wrap;
  const lo = .6 * (1 - Math.max(0, Math.min(1, wrap)));
  return { lo, hi: lo + .18 };
}
const PROJ_DEPTH_DEF = 3, PROJ_WRAP_DEF = .85;
// Render one basis into the GL canvas. Additive over whatever is already there, so the mirrored
// copy is a second call rather than a second sheet.
function projDrawGL(G, L, basis, halfW, halfH, slot, first, which, vpW, vpH){
  const gl = G.gl;
  const { p, n, t1, t2 } = basis;
  const depthLim = projDepthLim(L, halfW, halfH);
  const band = projFaceBand(L);
  const groups = projGroups(L, p, Math.hypot(halfW, halfH) + depthLim, slot);
  if (first) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  if (!groups.length) return 0;
  if (G.bytes > PROJ_GL_BUDGET) projGLFree();
  // Before anything is drawn: which surface does each ray of the beam meet first? The pre-pass
  // rebinds the framebuffer and the viewport, so it has to happen ahead of the colour pass, not
  // between its uniforms.
  const occ = projDepthMap(G, basis, halfW, halfH, depthLim, which, vpW, vpH);
  gl.useProgram(G.prog);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);               // premultiplied "over"
  const decalTex = projTexture(G, DecalStyle.bitmap(L.bmp, L.surf, L));   // styled, if the Look says so
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, decalTex);
  gl.uniform1i(G.u.tex, 0);
  // Unit 1 always has something bound even when there is no depth map, so the sampler is never
  // left dangling; uOccOn is what decides whether it is read.
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, occ || decalTex);
  gl.uniform1i(G.u.occ, 1);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1f(G.u.occOn, occ ? 1 : 0);
  gl.uniform1f(G.u.bias, PROJ_OCC_BIAS);
  gl.uniform3f(G.u.P, p.x, p.y, p.z);
  gl.uniform3f(G.u.N, n.x, n.y, n.z);
  gl.uniform3f(G.u.T1, t1.x, t1.y, t1.z);
  gl.uniform3f(G.u.T2, t2.x, t2.y, t2.z);
  gl.uniform2f(G.u.half, halfW, halfH);
  gl.uniform1f(G.u.depth, depthLim);
  gl.uniform1f(G.u.faceLo, band.lo);
  gl.uniform1f(G.u.faceHi, band.hi);
  gl.uniform1f(G.u.flipV, $("optFlipV").checked ? 1 : 0);
  const flip = $("optFlipV").checked;
  let verts = 0;
  for (const gd of groups) {
    const b = projBuffers(G, gd), B = Project.local(gd, basis);
    gl.uniform3f(G.u.P, B.p.x, B.p.y, B.p.z); gl.uniform3f(G.u.N, B.n.x, B.n.y, B.n.z);
    gl.uniform3f(G.u.T1, B.t1.x, B.t1.y, B.t1.z); gl.uniform3f(G.u.T2, B.t2.x, B.t2.y, B.t2.z);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.pos); gl.enableVertexAttribArray(G.a.pos); gl.vertexAttribPointer(G.a.pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.nrm); gl.enableVertexAttribArray(G.a.nrm); gl.vertexAttribPointer(G.a.nrm, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.uv);  gl.enableVertexAttribArray(G.a.uv);  gl.vertexAttribPointer(G.a.uv, 2, gl.FLOAT, false, 0, 0);
    // One draw per whole sheet this part's UVs cross (ROADMAP 4.23(a)). The ordinary part crosses
    // exactly one, so this is the same single draw call it was — and `projUVTiles` is cached on the
    // geometry, so the bounds are walked once per part rather than once per frame of a drag.
    const T = projUVTiles(gd, flip);
    for (let ty = T.y0; ty <= T.y1; ty++) for (let tx = T.x0; tx <= T.x1; tx++) {
      gl.uniform2f(G.u.tile, tx, ty);
      gl.drawArrays(gl.TRIANGLES, 0, b.n);
    }
    verts += b.n;
  }
  gl.uniform2f(G.u.tile, 0, 0);
  // Off again: an attribute left on keeps pointing at its part's buffer, and once projGLFree has
  // deleted that (every vehicle switch does) the next draw that does not use it — the depth pre-pass,
  // the brush's pre-pass, a bake's — fails whole with INVALID_OPERATION and draws nothing. Found in
  // review 2026-10-23: the brush's hidden-plate scene, after a switch, painted the plate (4 682 texels).
  for (const k of ["pos", "nrm", "uv"]) gl.disableVertexAttribArray(G.a[k]);
  return verts / 3;
}
// ---- the projected brush: a camera depth pre-pass and a dab pass (ROADMAP 1.19 + 1.20 + 4.51) ----
// docs/BRUSH_PROJECTION.md is the design. The dabs are placed by the 2-D walk on the SCREEN, and each
// is evaluated by every texel at its own point on the model: the candidate triangles are drawn in UV
// space exactly as the decal pass draws them (PROJ_VS, the same windows), and each fragment projects
// its world point through the camera and asks how much of each dab of the frame's batch covers it.
// So paint goes where the model is under the brush — across a part seam, round a UV island, never
// round a leading edge onto the side the camera cannot see — and a dab's size on the model does not
// depend on the island's texel density, or on how far away the camera was.
//
// The pre-pass is the camera's own view of every visible part, protected and other sheets included,
// because a part on another texture still hides what is behind it (the rule `projOccluders` holds
// for decals). Its depth is LINEAR across the model's own range, written as clip z so the depth test
// keeps the nearest at 16 bits over metres, not over the camera's 0.05–500 m perspective range.
// One object, so the brush adds one name to the shared scope here and one (`ProjBrush`) for the stroke.
const ProjBrushGL = {
  DVS: `
  attribute vec3 aPos;
  uniform mat4 uVP, uM;                  // uM: where the part is — its mesh's world matrix (a pose moves it)
  uniform vec2 uZ;
  varying float vT;
  void main(){
    vec4 c = uVP * uM * vec4(aPos, 1.);
    vT = (c.w - uZ.x) / (uZ.y - uZ.x);
    gl_Position = vec4(c.xy, (vT * 2. - 1.) * c.w, c.w);
  }`,
  // .9999, not 1: packDepth(1) is four zero bytes — the NEAREST value — and the clear (all ones) is what
  // "nothing here" reads as.
  DFS: `
  precision highp float;
  varying float vT;
  ${PROJ_PACK}
  void main(){ gl_FragColor = packDepth(clamp(vT, 0., .9999)); }`,
  // The dab pass. A dab is four vec4s: (screen centre in CSS px, 1 / screen radius, view depth),
  // (cos and sin of its turn, alpha, its reach in depth, 1.5 R), (colour, unused), (the slope of its own
  // surface's inverse depth on screen, unused). The loop bound has to be a
  // constant in WebGL1, so K is compiled in from what the context can hold (`get`). Every gate is
  // per FRAGMENT — the screen position, the facing and the depth test are the texel's own — and only the
  // tip's coverage and the dab's alpha are per dab; the dabs composite source-over in the order they
  // were laid, which is what the 2-D stroke buffer's own source-over does with them.
  // `height` makes it Panel line's pass (slice (b)): no compositing, each dab's bump summed into one
  // float, as `embossInto` adds them into the stroke's height field — (1 − q²)² over the dab, times its
  // depth, times its radius in THIS texel's own texels, so the wall's slope is the same at every brush
  // size and on every island, the rule embossInto states in sheet texels.
  // The pattern brush's pass (ROADMAP 4.55, the brush that reveals whole cells). Its colour is the
  // lattice's, laid on the model exactly as the "lattice, along the model" fill lays it
  // (`Procedural.evalTri`): the tile projected along the model's three axes from the texel's own place
  // in model space, the three blended by |normal|^sharp with each face's (u, v) flipped by the
  // normal's sign. What a dab decides is not the texel but its CELL: each face's cell owners at this
  // texel (`Procedural.latticeOwners`, up to four, so a shared border is either cell's) are moved from
  // the texel to their centres within the face's plane, through the part's place and the copy's
  // transform to the screen, and a cell is revealed when a dab's tip covers its centre by half or
  // more. So every texel of a cell answers alike, on whichever island, part or UV tile it lies: the
  // cells run on across every seam and stop only at their own borders. The texel's own gates — the
  // depth pre-pass, the facing band and the dab's reach — still apply, so nothing round an edge or
  // behind another part is painted. The tile is premultiplied with mips and repeats (a power of two
  // each way), sampled at the unbroken tile coordinate so no mip seam runs along a period's edge; the
  // owners are nearest-sampled at the same coordinate. The tip is a copy WITHOUT mips (`latTip`): its
  // centre test runs under a branch, where an implicit derivative is undefined.
  LAT(K){
    return `
  uniform sampler2D uPat, uOwn, uCells;
  uniform vec4 uLatT;           // the tile's width and height on the model in metres, cos and sin of its angle
  uniform vec4 uLatC;           // the tile in cell units (w, h), its offset in tiles (x, y)
  uniform float uSharp;
  vec2 cellAt(float i){
    vec4 e = floor(texture2D(uCells, vec2((i + .5) / 64., .5)) * 255. + .5);
    return vec2(e.r * 256. + e.g, e.b * 256. + e.a) / 65535. * 16. - 8.;
  }
  vec4 cells(vec2 s, float w, float g){
    vec3 Nm = normalize(vNrm), wt = pow(abs(Nm), vec3(uSharp));
    float ws = wt.x + wt.y + wt.z;
    if (!(ws > 1e-12)) { wt = vec3(0., 1., 0.); ws = 1.; }
    wt *= step(ws * 1e-3, wt);
    wt /= wt.x + wt.y + wt.z;
    vec4 col[3];
    vec4 sc[12];
    float rem[3];
    for (int k = 0; k < 3; k++) {
      // Procedural.evalTri's faces: (z, -y) along x, (z, -x) along y, (x, -y) along z, u flipped by the normal
      vec3 eu = k == 0 ? vec3(0., 0., Nm.x < 0. ? 1. : -1.) : k == 1 ? vec3(0., 0., Nm.y < 0. ? -1. : 1.) : vec3(Nm.z < 0. ? -1. : 1., 0., 0.);
      vec3 ev = k == 1 ? vec3(-1., 0., 0.) : vec3(0., -1., 0.);
      float u = dot(vPos, eu), v = dot(vPos, ev);
      vec2 T = vec2(u * uLatT.z + v * uLatT.w, v * uLatT.z - u * uLatT.w) / uLatT.xy - uLatC.zw, n = floor(T);
      col[k] = texture2D(uPat, T);
      vec4 o = floor(texture2D(uOwn, T) * 255. + .5);
      for (int j = 0; j < 4; j++) {
        float id = j == 0 ? o.r : j == 1 ? o.g : j == 2 ? o.b : o.a;
        vec4 q = vec4(0.);
        if (wt[k] > 0. && id < 254.5) {
          vec2 dr = (n + cellAt(id) / uLatC.xy - T) * uLatT.xy;              // texel to centre, turned
          vec2 du = vec2(dr.x * uLatT.z - dr.y * uLatT.w, dr.x * uLatT.w + dr.y * uLatT.z);
          vec4 c = uVP * (uXf * vec4(vPos + du.x * eu + du.y * ev, 1.));
          if (c.w > 1e-6) q = vec4(vec2(c.x / c.w * .5 + .5, .5 - c.y / c.w * .5) * uView, 1., 0.);
        }
        sc[4 * k + j] = q;
      }
      rem[k] = 1.;
    }
    for (int i = 0; i < ${K}; i++) {
      if (i >= uN) break;
      vec4 a = uD[4 * i], b = uD[4 * i + 1], h = uD[4 * i + 3];
      // h.z: how far past the dab's own reach a cell it reveals can run, in px — nothing nearer can be one
      if (length(s - a.xy) * a.z > 1.5 + h.z * a.z) continue;
      float ze = 1. / max(1. / a.w + dot(h.xy, s - a.xy), 1e-6);
      float al = b.z * g * (1. - smoothstep(.9, 1., abs(w - ze) / b.w));
      for (int k = 0; k < 3; k++) {
        float hit = 0.;
        for (int j = 0; j < 4; j++) {
          vec4 q = sc[4 * k + j];
          vec2 d = (q.xy - a.xy) * a.z, l = vec2(b.x * d.x + b.y * d.y, b.x * d.y - b.y * d.x) * uTipK;
          if (q.z > 0. && max(abs(l.x), abs(l.y)) < 1.) hit = max(hit, step(.5, texture2D(uTip, l * .5 + .5).a));
        }
        rem[k] *= 1. - al * hit;
      }
    }
    vec4 acc = vec4(0.);
    for (int k = 0; k < 3; k++) acc += wt[k] * (1. - rem[k]) * col[k];
    return acc;                                                            // premultiplied, as the tile is
  }`;
  },
  // `lat` makes it the pattern brush's pass, `LAT` above.
  fs(K, height, lat){
    return `#extension GL_OES_standard_derivatives : enable
  precision highp float;
  uniform vec4 uD[${4 * K}];
  uniform int uN;
  uniform mat4 uVP, uXf;
  uniform mat3 uXn;
  uniform vec3 uCam;
  uniform vec2 uView, uZ, uTipK;
  uniform float uF, uFaceLo, uFaceHi;
  uniform sampler2D uTip, uOcc;
  varying vec3 vPos; varying vec3 vNrm;
  ${PROJ_PACK}
  ${lat ? ProjBrushGL.LAT(K) : ""}
  void main(){
    // Where this texel is, as the stroke sees it: the part's arrays through its own place (a pose moves
    // it) and, for a copy of the stroke (slice (d)), on through the copy's transform back onto the
    // stroke — the mirror's reflection or a radial turn back. One matrix and its normal matrix a part
    // (ProjBrush.parts); the identity for a part at rest painted by the stroke itself.
    vec3 P = (uXf * vec4(vPos, 1.)).xyz, N = uXn * vNrm;
    vec4 c = uVP * vec4(P, 1.);
    float w = max(c.w, 1e-6);
    vec2 ndc = c.xy / w;
    vec2 s = vec2(ndc.x * .5 + .5, .5 - ndc.y * .5) * uView;      // CSS px, y down, like the pointer
    // Facing the camera from this texel's own point: a smooth band, so a silhouette fades.
    float nd = dot(normalize(N), normalize(uCam - P));
    float g = smoothstep(uFaceLo, uFaceHi, nd) * step(1e-6, c.w);
    // Depth: only the first surface the camera sees here. The bias is one and a half pre-pass pixels
    // of the surface's own slope at this depth, so it is the same tolerance zoomed in or out.
    float t = (w - uZ.x) / (uZ.y - uZ.x);
    float near = unpackDepth(texture2D(uOcc, ndc * .5 + .5));
    float tanA = sqrt(max(0., 1. - nd * nd)) / max(nd, .087);
    g *= step(t, near + 1.5 * w / uF * (1. + tanA) / (uZ.y - uZ.x));
    ${lat ? "gl_FragColor = cells(s, w, g); return;" : ""}
    ${height ? "float mpt = max(.5 * (length(dFdx(vPos)) + length(dFdy(vPos))), 1e-9);   // metres a sheet texel here" : ""}
    vec4 acc = vec4(0.);
    for (int i = 0; i < ${K}; i++) {
      if (i >= uN) break;
      vec4 a = uD[4 * i], b = uD[4 * i + 1], col = uD[4 * i + 2], h = uD[4 * i + 3];
      vec2 d = (s - a.xy) * a.z;                                    // the dab's own radius = 1
      // Reach (slice (c)): only surfaces within 1.5 R in depth of the dab's OWN surface here — the plane
      // fitted at its centre, in inverse depth, which is linear on screen for a plane — so a tilted panel
      // keeps the whole dab while whatever shows past a wing's edge, metres behind it, is left alone.
      float ze = 1. / max(1. / a.w + dot(h.xy, s - a.xy), 1e-6);
      float rch = 1. - smoothstep(.9, 1., abs(w - ze) / b.w);
      // turned back by the dab's angle (canvas rotation, clockwise with y down), then scaled to the tip's
      // longer side, which is the dab's size — Tips.lay's rule
      vec2 l = vec2(b.x * d.x + b.y * d.y, b.x * d.y - b.y * d.x) * uTipK;
      // The tip's own box, antialiased over one texel of the SHEET (fwidth is per texel here, this being
      // a UV-space draw): a hard tip turned 30° has a clean edge, not a staircase of texel centres. At a
      // dab on whole texels the box's edges fall between texel centres and this is exactly 0 or 1.
      ${height ? `float q = min(dot(l, l), 1.);
      acc.r += b.z * g * rch * (col.x / mpt + .5) * (1. - q) * (1. - q);    // col.x: the dab's radius in metres` : `vec2 cv = clamp((1. - abs(l)) / max(fwidth(l), vec2(1e-6)) + .5, 0., 1.);
      float inside = cv.x * cv.y;
      float al = texture2D(uTip, l * .5 + .5).a * inside * b.z * g * rch;
      acc = vec4(col.rgb * al, al) + acc * (1. - al);`}
    }
    gl_FragColor = ${height ? "vec4(acc.r, 0., 0., 1.)" : "acc"};          // premultiplied colour, or the field's sum
  }`;
  },
  // What the brush needs from the context, made once per context: two programs, and the answer to
  // whether it can run at all. `EXT_blend_minmax` is how a texel two triangles share takes one answer
  // (BRUSH_PROJECTION.md piece 4), 32-bit indices are how a frame draws only its chosen triangles of a
  // part with more than 65 535 vertices, and derivatives antialias a tip's edge. Without any of them, or
  // with room for fewer than 4 dabs, the brush keeps `stamp3d` and `G.brushWhy` says why.
  K_MAX: 64,
  I: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), I3: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  get(G){
    if (G.brush !== undefined) return G.brush;
    const gl = G.gl, max = gl.getExtension("EXT_blend_minmax"), uint = gl.getExtension("OES_element_index_uint"),
      der = gl.getExtension("OES_standard_derivatives");
    const K = Math.min(ProjBrushGL.K_MAX, Math.floor((gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) - 24) / 4));
    G.brushWhy = !max ? "this GPU has no EXT_blend_minmax" : !uint ? "this GPU has no 32-bit indices" : !der ? "this GPU has no OES_standard_derivatives"
      : K < 4 ? "this GPU has room for only " + Math.max(0, K) + " dabs a draw" : null;
    if (G.brushWhy) return (G.brush = null);
    const link = (vs, fs) => {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error("projected brush shader: " + gl.getShaderInfoLog(sh));
        gl.attachShader(p, sh);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("projected brush link: " + gl.getProgramInfoLog(p));
      return p;
    };
    let prog, dprog;
    try { prog = link(PROJ_VS, ProjBrushGL.fs(K)); dprog = link(ProjBrushGL.DVS, ProjBrushGL.DFS); }
    catch (err) { G.brushWhy = err.message; return (G.brush = null); }       // said by the caller, once
    const un = (p, names) => Object.fromEntries(names.map(n => [n, gl.getUniformLocation(p, "u" + n)]));
    // A dab program's handles: the colour pass's (the brush object itself, which ProjWin.aim takes) and
    // Panel line's are the same shape.
    const record = p => ({ prog: p,
      a: { uv: gl.getAttribLocation(p, "aUV"), pos: gl.getAttribLocation(p, "aPos"), nrm: gl.getAttribLocation(p, "aNrm") },
      u: Object.assign(un(p, ["D", "N", "VP", "Xf", "Xn", "Cam", "View", "Z", "TipK", "F", "FaceLo", "FaceHi", "Tip", "Occ", "FlipV", "Tile"]),
        { win: gl.getUniformLocation(p, "uWin") }) });
    return (G.brush = Object.assign(record(prog), { K, max, dprog, ibuf: gl.createBuffer(), occ: null, tip: null, link, record,
      da: { pos: gl.getAttribLocation(dprog, "aPos") }, du: un(dprog, ["VP", "M", "Z"]) }));
  },
  // Panel line's pass, made the first time it is asked for: its program, and a float target of HT² to
  // draw a window into and read back, MAX-blended like the colour pass. Null where the context cannot
  // render to float and blend it — Panel line then keeps `stamp3d`, as the design says (piece 8).
  HT: 1024,
  height(G, B){
    if (B.height !== undefined) return B.height;
    const gl = G.gl, ok = gl.getExtension("OES_texture_float") && gl.getExtension("WEBGL_color_buffer_float") && gl.getExtension("EXT_float_blend");
    if (!ok) return (B.height = null);
    let prog;
    try { prog = B.link(PROJ_VS, ProjBrushGL.fs(B.K, true)); } catch (err) { return (B.height = null); }
    const T = Math.min(ProjBrushGL.HT, G.tile), tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, T, T, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const done = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!done) { gl.deleteFramebuffer(fb); gl.deleteTexture(tex); return (B.height = null); }
    return (B.height = Object.assign(B.record(prog), { fb, tex, T, buf: new Float32Array(T * T * 4) }));
  },
  // The pattern brush's pass (`LAT`), made the first time it is asked for: its program, its three
  // textures and the tip without mips. Null where it will not link — the stroke is then refused, never
  // laid as plain dabs (`ProjBrush.start`).
  lattice(G, B){
    if (B.lat !== undefined) return B.lat;
    const gl = G.gl;
    let prog;
    try { prog = B.link(PROJ_VS, ProjBrushGL.fs(B.K, false, true)); } catch (err) { G.latWhy = err.message; return (B.lat = null); }
    const P = B.record(prog), un = n => gl.getUniformLocation(prog, "u" + n);
    Object.assign(P.u, { Pat: un("Pat"), Own: un("Own"), Cells: un("Cells"), LatT: un("LatT"), LatC: un("LatC"), Sharp: un("Sharp") });
    const tex = () => gl.createTexture();
    return (B.lat = Object.assign(P, { lat: true, pat: tex(), own: tex(), cells: tex(), tipTex: tex(), key: null }));
  },
  // One texture from `src` (a canvas, or { w, h, d } bytes), its filtering and wrap; `pre` uploads it
  // premultiplied, so its mips cannot pull a clear texel's colour into its neighbours.
  latTex(gl, tex, src, mips, wrap, pre){
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);                 // row 0 is the tile's top, as Procedural reads it
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!pre);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    if (src.d) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, src.w, src.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.d);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : mips === false ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mips === null ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  },
  // The stroke's lattice `L` (`ProjBrush.lattice`) onto pass P: the tile and its owners when they have
  // changed since the last stroke, the tip as this stroke's stamp, and the uniforms.
  latSetup(G, P, L, stamp){
    const gl = G.gl;
    if (P.key !== L.key) {
      ProjBrushGL.latTex(gl, P.pat, L.tile, true, gl.REPEAT, true);
      ProjBrushGL.latTex(gl, P.own, { w: L.own.W, h: L.own.H, d: L.own.own }, null, gl.REPEAT);
      ProjBrushGL.latTex(gl, P.cells, { w: 64, h: 1, d: L.own.centres }, null, gl.CLAMP_TO_EDGE);
      P.key = L.key;
    }
    ProjBrushGL.latTex(gl, P.tipTex, stamp, false, gl.CLAMP_TO_EDGE);
    gl.useProgram(P.prog);
    const a = L.angle * Math.PI / 180;
    gl.uniform4f(P.u.LatT, L.size, L.size * L.C.h / L.C.w, Math.cos(a), Math.sin(a));
    gl.uniform4f(P.u.LatC, L.C.w, L.C.h, 0, 0);
    gl.uniform1f(P.u.Sharp, L.sharp);
    gl.uniform1i(P.u.Pat, 2); gl.uniform1i(P.u.Own, 3); gl.uniform1i(P.u.Cells, 4);
  },
  // ---- bleed (slice (c)) ----
  // The fill rule covers a texel when its centre is inside a triangle, so an island's outermost row and
  // the gutter round it stay as they were, and the preview's mips pull them in as a line of the old
  // colour along every island's edge. Blender's answer is "bleed": after the projection, a gutter texel
  // within BLEED of an island takes the strongest of its island neighbours. Gutter means no island AT
  // ALL — the slot's coverage, drawn here by the same fill rule as the dab pass, once per slot and size
  // — so paint never bleeds onto a neighbouring island that is another surface.
  BLEED: 2,
  // Rect `r` of a W × H sheet's coverage, into `out` (a byte a texel, row-major from the top).
  cover(G, B, gds, W, H, r, out){
    const gl = G.gl, flip = $("optFlipV").checked;
    const P = B.cov || (B.cov = B.record(B.link(PROJ_VS, "precision mediump float;\nvoid main(){ gl_FragColor = vec4(1.); }")));
    let buf = null;
    ProjWin.fit(G, W, H);
    for (const t of ProjWin.windows(G, W, H, r)) {
      ProjWin.aim(G, W, H, t, P);
      gl.uniform1f(P.u.FlipV, flip ? 1 : 0);
      gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      const on = ["pos", "nrm", "uv"].filter(k => P.a[k] >= 0);
      for (const k of on) gl.enableVertexAttribArray(P.a[k]);
      for (const gd of gds) {
        const b = projBuffers(G, gd), T = projUVTiles(gd, flip);
        for (const k of on) { gl.bindBuffer(gl.ARRAY_BUFFER, b[k]); gl.vertexAttribPointer(P.a[k], k === "uv" ? 2 : 3, gl.FLOAT, false, 0, 0); }
        for (let ty = T.y0; ty <= T.y1; ty++) for (let tx = T.x0; tx <= T.x1; tx++) { gl.uniform2f(P.u.Tile, tx, ty); gl.drawArrays(gl.TRIANGLES, 0, b.n); }
      }
      for (const k of on) gl.disableVertexAttribArray(P.a[k]);
      if (!buf || buf.length < t.w * t.h * 4) buf = new Uint8Array(t.w * t.h * 4);
      gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      for (let y = 0; y < t.h; y++) {
        const row = (t.h - 1 - y) * t.w * 4, o = (t.y + y) * W + t.x;
        for (let x = 0; x < t.w; x++) out[o + x] = buf[row + x * 4] ? 255 : 0;   // 255: the fill samples it as 1.0
      }
    }
    gl.disable(gl.SCISSOR_TEST);
  },
  FILL_VS: `attribute vec2 aQ; void main(){ gl_Position = vec4(aQ, 0., 1.); }`,
  fillFS(g){
    return `precision highp float;
  uniform sampler2D uCol, uCov;
  uniform vec2 uColSize, uWin, uOrg;
  uniform vec4 uCovBox;
  float cov(vec2 q){ return texture2D(uCov, (q - uCovBox.xy + .5) / uCovBox.zw).r; }
  vec4 col(vec2 f){ return texture2D(uCol, (f + .5) / uColSize); }
  void main(){
    vec2 f = floor(gl_FragCoord.xy), q = vec2(uOrg.x + f.x, uOrg.y + uWin.y - 1. - f.y);   // window texel, sheet texel
    vec4 m = col(f);
    if (cov(q) < .5) {
      for (int dy = -${g}; dy <= ${g}; dy++) for (int dx = -${g}; dx <= ${g}; dx++) {
        vec2 ff = f + vec2(float(dx), -float(dy));                  // the sheet's rows run down, the window's up
        if (ff.x < 0. || ff.y < 0. || ff.x >= uWin.x || ff.y >= uWin.y) continue;
        if (cov(q + vec2(float(dx), float(dy))) > .5) { vec4 c = col(ff); if (c.a > m.a) m = c; }   // whole: a per-channel max would mix two colours
      }
    }
    gl_FragColor = m;
  }`;
  },
  // Bleed window `t` of a sw × sh sheet, just drawn by the colour pass and still in the buffer: copied
  // to a texture, the coverage round it uploaded (a byte a texel), and the window drawn again through the
  // fill — island texels as they were, gutter texels from their neighbours.
  bleed(G, B, mask, t, sw, sh){
    const gl = G.gl, g = ProjBrushGL.BLEED;
    let F = B.fill;
    if (!F) {
      const p = B.link(ProjBrushGL.FILL_VS, ProjBrushGL.fillFS(g)), u = n => gl.getUniformLocation(p, n);
      F = B.fill = { prog: p, aQ: gl.getAttribLocation(p, "aQ"), quad: gl.createBuffer(), col: gl.createTexture(), cov: gl.createTexture(), cw: 0, ch: 0,
        u: { col: u("uCol"), cov: u("uCov"), colSize: u("uColSize"), win: u("uWin"), org: u("uOrg"), covBox: u("uCovBox") } };
      gl.bindBuffer(gl.ARRAY_BUFFER, F.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      for (const tex of [F.col, F.cov]) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
                              [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      }
    }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, F.col);
    if (F.cw < t.w || F.ch < t.h) {                           // grown, never per window
      F.cw = Math.max(F.cw, t.w); F.ch = Math.max(F.ch, t.h);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, F.cw, F.ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, t.w, t.h);
    const x0 = Math.max(0, t.x - g), y0 = Math.max(0, t.y - g), x1 = Math.min(sw, t.x + t.w + g), y1 = Math.min(sh, t.y + t.h + g);
    const cw = x1 - x0, ch = y1 - y0, sub = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) sub.set(mask.subarray((y0 + y) * sw + x0, (y0 + y) * sw + x1), y * cw);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, F.cov);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, cw, ch, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, sub);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.useProgram(F.prog);
    gl.uniform1i(F.u.col, 0); gl.uniform1i(F.u.cov, 1);
    gl.uniform2f(F.u.colSize, F.cw, F.ch); gl.uniform2f(F.u.win, t.w, t.h); gl.uniform2f(F.u.org, t.x, t.y);
    gl.uniform4f(F.u.covBox, x0, y0, cw, ch);
    gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, F.quad);
    gl.enableVertexAttribArray(F.aQ); gl.vertexAttribPointer(F.aQ, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(F.aQ);
    gl.activeTexture(gl.TEXTURE0);
  },
  // The camera's depth pre-pass, once per stroke: rendered into a target the size of the 3-D view in
  // CSS pixels and read back once, so that a dab's centre is a lookup rather than a raycast. Returns
  // the CPU copy (RGBA8, GL's rows bottom-up); the texture stays on B.occ for the dab pass.
  depth(G, B, cam, groups, placed){                 // placed(gd): where that part is, column-major (a pose moves it)
    const gl = G.gl, W = cam.W, H = cam.H;
    let T = B.occ;
    if (!T || T.W !== W || T.H !== H) {
      if (T) { gl.deleteTexture(T.tex); gl.deleteRenderbuffer(T.rb); gl.deleteFramebuffer(T.fb); }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      // NEAREST: a packed depth cannot be interpolated (projOccTarget)
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
                            [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, W, H);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) return null;
      T = B.occ = { tex, rb, fb, W, H, data: new Uint8Array(W * H * 4) };
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
    gl.clearColor(1, 1, 1, 1); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(B.dprog);
    gl.uniformMatrix4fv(B.du.VP, false, cam.vp);
    gl.uniform2f(B.du.Z, cam.z0, cam.z1);
    // only its own attribute on, whatever an earlier pass left (see projDrawGL)
    for (let i = 0, n = gl.getParameter(gl.MAX_VERTEX_ATTRIBS); i < n; i++) gl.disableVertexAttribArray(i);
    gl.enableVertexAttribArray(B.da.pos);
    for (const gd of groups) {
      const b = projBuffers(G, gd);
      gl.uniformMatrix4fv(B.du.M, false, placed ? placed(gd) : ProjBrushGL.I);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.pos);
      gl.vertexAttribPointer(B.da.pos, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, b.n);
    }
    gl.disableVertexAttribArray(B.da.pos);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, T.data);
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return T.data;
  },
  // The tip, once per stroke, as a mipmapped texture: a dab much smaller on the sheet than the tip's
  // image samples its average the way drawImage does when it shrinks. Only its alpha is read.
  tip(G, B, stamp){
    const gl = G.gl, w = projPot(stamp.width, G.maxTex), h = projPot(stamp.height, G.maxTex);
    let img = stamp;
    if (w !== stamp.width || h !== stamp.height) {
      img = mkCanvas(w, h);
      const g = ctx2d(img); g.imageSmoothingQuality = "high"; g.drawImage(stamp, 0, 0, w, h);
    }
    if (!B.tip) B.tip = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, B.tip);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);                 // row 0 is the tip's top, as in Tips.lay
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  },
  // The stroke's fixed uniforms — camera, depth range, tip, facing band — set once per stroke on the
  // brush's program, where they stay: no other pass uses it.
  setup(G, B, cam, tipK, band, P = B){
    const gl = G.gl, U = P.u;
    gl.useProgram(P.prog);
    gl.uniformMatrix4fv(U.VP, false, cam.vp);
    gl.uniform3f(U.Cam, cam.pos[0], cam.pos[1], cam.pos[2]);
    gl.uniform2f(U.View, cam.W, cam.H);
    gl.uniform2f(U.Z, cam.z0, cam.z1);
    gl.uniform2f(U.TipK, tipK[0], tipK[1]);
    gl.uniform1f(U.F, cam.f);
    gl.uniform1f(U.FaceLo, band.lo); gl.uniform1f(U.FaceHi, band.hi);
    gl.uniform1i(U.Tip, 0); gl.uniform1i(U.Occ, 1);
  },
  // One batch (at most K dabs, packed by the caller into `dabs`, `n` of them) into one window `t` of a
  // sw × sh sheet: every chosen triangle of every part in `parts` — `{ gd, off, n, tiles, xf, xn }`,
  // their indices at `off` of the index buffer the caller filled, drawn through `xf` (the part's place
  // and the copy's transform; ProjBrush.parts) — with MAX blending, so a texel two copies or two
  // triangles share takes the larger of their two answers, never both (BRUSH_PROJECTION.md piece 4).
  // `P` is the program to draw with — B itself for colour, B.height for Panel line, which draws into
  // its float target and leaves it bound for the caller's readback.
  draw(G, B, dabs, n, t, sw, sh, parts, P = B){
    const gl = G.gl, U = P.u;
    if (P.fb) gl.bindFramebuffer(gl.FRAMEBUFFER, P.fb);
    ProjWin.aim(G, sw, sh, t, P);
    if (P !== B && P.pat) {                         // the pattern brush's tile, owners and centres
      for (const [unit, tex] of [[2, P.pat], [3, P.own], [4, P.cells]]) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
    }
    gl.uniform4fv(U.D, dabs);
    gl.uniform1i(U.N, n);
    gl.uniform1f(U.FlipV, $("optFlipV").checked ? 1 : 0);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND); gl.blendEquation(B.max.MAX_EXT); gl.blendFunc(gl.ONE, gl.ONE);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, B.occ.tex);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, P.tipTex || B.tip);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, B.ibuf);
    for (const k of ["pos", "nrm", "uv"]) gl.enableVertexAttribArray(P.a[k]);
    for (const p of parts) {
      const b = projBuffers(G, p.gd);
      gl.uniformMatrix4fv(U.Xf, false, p.xf || ProjBrushGL.I); gl.uniformMatrix3fv(U.Xn, false, p.xn || ProjBrushGL.I3);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.pos); gl.vertexAttribPointer(P.a.pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.nrm); gl.vertexAttribPointer(P.a.nrm, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.uv);  gl.vertexAttribPointer(P.a.uv, 2, gl.FLOAT, false, 0, 0);
      for (const [tx, ty] of p.tiles) { gl.uniform2f(U.Tile, tx, ty); gl.drawElements(gl.TRIANGLES, p.n, gl.UNSIGNED_INT, p.off * 4); }
    }
    for (const k of ["pos", "nrm", "uv"]) gl.disableVertexAttribArray(P.a[k]);
    // The decal pass sets its own blend function on every draw but never the equation.
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
  },
};
// A texel whose CENTRE falls outside every triangle is not covered by any exact fill rule, so a
// UV island can lose its outermost row — the gap the 2.5 % inflate was really there to hide. Fill
// it properly instead: lay the result down, then paint the same image one texel out in eight
// directions UNDERNEATH it. Covered texels keep their own colour exactly; only holes take a
// neighbour's. This is the same idea as the exporter's seam padding, one step wide.
// How much of the sheet the projection actually covered, and WHERE. The GPU knows only how many
// triangles were SUBMITTED — the shader discards by depth, facing and image bounds — so both
// questions have to be read back, and a downscaled probe answers them without a full-sheet read.
//
// The box is what ROADMAP 4.8b needs: a projected decal's surface response walks per pixel, and
// without a bounding box that walk is the whole sheet. Reading the sheet back to find one is the
// 29.9 ms full-surface `getImageData` that 1.11 measured and removed, so this is the cheap answer —
// it rides on a readback that already happens, and only when the drag is over (`live` skips it).
//
// **The probe's size is chosen so the box cannot lose anything.** A mipmapped downscale averages alpha, so a
// lone opaque texel in a 32×32 cell comes back at 255/1024 ≈ 0.25 and rounds to **zero** — the box
// would then stop short of the decal's own edge and the gloss would come out clipped. Capping the
// factor at 16 keeps a single opaque texel at alpha ≥ 1. At 4096² that is a 256² probe (256 KB),
// at 8192² a 512² one (1 MB), against 268 MB for the sheet.
function projCoverage(glCanvas, sx, sy, sw, sh){
  const n = Math.max(128, Math.min(512, 1 << Math.ceil(Math.log2(Math.max(1, Math.max(sw, sh) / 16)))));
  // willReadFrequently is right HERE and wrong on a sheet: this probe is only ever read back,
  // never used as a `drawImage` source, so it wants to live CPU-side. Without it Chrome warns on
  // every readback and the canvas ping-pongs across the bus.
  let p = projCoverage._c;
  if (!p) p = projCoverage._c = document.createElement("canvas");
  if (p.width !== n) { p.width = p.height = n; }
  const g = p.getContext("2d", { willReadFrequently: true });
  g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.filter = "none";
  // MIPMAPPED, so every texel counts. The default ("low") is bilinear and samples a 2 × 2 patch per
  // cell: a 1-px opaque column on a 4096-wide sheet was seen at 2 of its 16 phases, and a drag left it
  // behind as a trail (review of 1.18, 2026-10-23). "medium" averages it to 16 at every phase and a
  // single opaque texel to 2, at no measurable cost — the GL snapshot is the bill (155 ms against 157
  // at 4096², software GL).
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "medium";
  g.clearRect(0, 0, n, n);
  g.drawImage(glCanvas, sx, sy, sw, sh, 0, 0, n, n);
  const d = g.getImageData(0, 0, n, n).data;
  let hit = 0, px0 = n, py0 = n, px1 = -1, py1 = -1;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!d[(y * n + x) * 4 + 3]) continue;
    hit++;
    if (x < px0) px0 = x; if (x > px1) px1 = x;
    if (y < py0) py0 = y; if (y > py1) py1 = y;
  }
  // One probe cell of padding each way. The cell is the resolution of the answer, and the emboss
  // pass reads a neighbour on each side, so the true edge must not sit on the box's border.
  const kx = sw / n, ky = sh / n;
  const box = px1 < 0 ? null : {
    x: Math.max(0, Math.floor((px0 - 1) * kx)), y: Math.max(0, Math.floor((py0 - 1) * ky)),
    w: 0, h: 0 };
  if (box) {
    box.w = Math.min(sw, Math.ceil((px1 + 2) * kx)) - box.x;
    box.h = Math.min(sh, Math.ceil((py1 + 2) * ky)) - box.y;
  }
  // scale the probe's hit count back to the sheet it stands for
  return { texels: Math.round(hit * (sw * sh) / (n * n)), box };
}
// ---- no dilation here, and that is deliberate ----
// A gutter fill has to touch ONLY texels the projection genuinely missed, and canvas compositing
// cannot express that on a partially transparent layer. `destination-over` is not "fill where
// empty", it is "composite underneath": 0.5 under 0.5 is 0.75, not 0.5. So on a decal left
// semi-transparent by background removal — which is what every keyed-out logo is at its edge —
// eight offset draws pushed an authored alpha of 128 to 253 (measured 2026-08-04), which is the
// same "composited more than once" defect the GPU path exists to remove, reintroduced one line
// later. Ordering them destination-over first still reached 224.
// With grow = 0 the result is exact: a 50 % decal comes out at mean 128, max 128, no texel above
// its authored alpha. Filling the outer row of a UV island is `padSeams`' job at export time,
// where it is done against a real UV mask instead of guessed from neighbouring alpha, and it is
// on by default. If a preview-side gutter is ever wanted it has to happen on the GPU, before the
// alpha is flattened into a canvas.
// One window of the sheet at a time: the windows tile the sheet, so clearing each one's own
// rectangle clears the whole of it.
function projBlit(target, glCanvas, sx, sy, sw, sh, dx = 0, dy = 0){
  const g = ctx2d(target);
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.filter = "none";
  g.clearRect(dx, dy, sw, sh);
  g.drawImage(glCanvas, sx, sy, sw, sh, dx, dy, sw, sh);
}
/*==ENDPROJGL==*/
