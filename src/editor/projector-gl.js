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
varying vec3 vPos; varying vec3 vNrm;
void main(){
  vPos = aPos; vNrm = aNrm;
  float v = uFlipV > .5 ? 1. - aUV.y : aUV.y;
  // uTile slides the whole part by a whole sheet, so a tiled UV (the t55e1 gun barrel runs u to
  // 6.353) is drawn once per repeat instead of once, off the edge (ROADMAP 4.23(a)). NOT fract():
  // folding each vertex independently tears every triangle that straddles a boundary, which is the
  // smear the item warned about. A translation cannot.
  gl_Position = vec4((aUV.x - uTile.x) * 2. - 1., (v - uTile.y) * 2. - 1., 0., 1.);
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
         tex: u("uTex"), occ: u("uOcc"), occOn: u("uOccOn"), bias: u("uBias"), tile: u("uTile") },
    dU: { P: du("uP"), N: du("uN"), T1: du("uT1"), T2: du("uT2"), half: du("uHalf"), depth: du("uDepth") },
    maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
  // A lost context leaves every cached buffer and texture dangling. Bump the generation so the
  // per-part buffers rebuild, and say so rather than rendering nothing.
  canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); App._projGL = null; setStatus("Graphics context was lost — the projection will rebuild on the next change", "err"); });
  return App._projGL = G2;
}
function projPot(n, max){ let p = 1; while (p < n) p <<= 1; return Math.max(1, Math.min(p, max)); }
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
    const bb = gdBounds(gd);
    if (p.x < bb.x0 - reach || p.x > bb.x1 + reach || p.y < bb.y0 - reach || p.y > bb.y1 + reach ||
        p.z < bb.z0 - reach || p.z > bb.z1 + reach) continue;
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
    const bb = gdBounds(gd);
    if (p.x < bb.x0 - reach || p.x > bb.x1 + reach || p.y < bb.y0 - reach || p.y > bb.y1 + reach ||
        p.z < bb.z0 - reach || p.z > bb.z1 + reach) continue;
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
  for (const gd of groups) sig += "|" + gd.name;
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
    const b = projBuffers(G, gd);
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
    const b = projBuffers(G, gd);
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
  return verts / 3;
}
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
// **The probe's size is chosen so the box cannot lose anything.** Downscaling averages alpha, so a
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
function projBlit(target, glCanvas, sx, sy, sw, sh){
  const g = ctx2d(target);
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.filter = "none";
  g.clearRect(0, 0, target.width, target.height);
  g.drawImage(glCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
}
/*==ENDPROJGL==*/
