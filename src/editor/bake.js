/*==BAKE==*/
"use strict";
// ---------- Mask generators from the model (ROADMAP 4.44, first candidate) ----------
// Edge wear and dirt in cavities are what make a skin read as a first-party one, and both are
// functions of the MESH, not of the painter: where a surface bends outward, paint chips off; where
// it bends inward, or sits under something, grime collects. Substance calls the maps that carry
// those facts "smart masks". Here they are two bakes per texture — curvature and occlusion — that a
// layer's mask can be made from, through a levels control (`MaskBake`, ui/panels/mask-bake.js).
//
// This section is the pure half: no DOM, no App, no GL, so the bake pool lifts it into a worker
// (a real airframe is two million vertex copies, and welding them is over the 200 ms line of
// CLAUDE.md §3.5) and `tools/t66_bake.mjs` runs it under Node against shapes whose curvature is
// known exactly. The GPU half — rasterising a per-vertex value into UV space, and the occlusion
// bake, which is all shadow maps — is `Bake`, below the marker.
const BakeMesh = {
  // "The same point": 0.05 mm. Positions are metres, and the copies of one vertex that a UV seam
  // or a hard edge splits agree to well under that — they were one vertex before the split. A
  // tolerance at the float's own LSB would miss copies that were transformed separately.
  QUANT: 2e4,
  // Which copies share a position: `mid[i]` is the merged id of copy i, `count` how many there are.
  // Open addressing over one Int32Array rather than a Map keyed by a string, because a real model
  // is two million copies and a string per copy is the difference between ~100 ms and seconds.
  // The table stores the FIRST copy at each position; a later copy compares its quantised
  // coordinates against that one's, so nothing has to be stored beyond one int per slot.
  weld(pos, quant){
    const n = (pos.length / 3) | 0;
    let cap = 1;
    while (cap < n * 2) cap <<= 1;
    const mask = cap - 1;
    const first = new Int32Array(cap).fill(-1);
    const mid = new Int32Array(n);
    let count = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.round(pos[i*3] * quant), y = Math.round(pos[i*3+1] * quant), z = Math.round(pos[i*3+2] * quant);
      let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
      for (;;) {
        const f = first[h];
        if (f < 0) { first[h] = i; mid[i] = count++; break; }
        if (Math.round(pos[f*3] * quant) === x && Math.round(pos[f*3+1] * quant) === y && Math.round(pos[f*3+2] * quant) === z) { mid[i] = mid[f]; break; }
        h = (h + 1) & mask;
      }
    }
    return { mid, count };
  },
  // A quantisation step that cannot overflow an int32 whatever units the file is in: 0.05 mm for
  // anything up to ~50 km across, coarser only for a model whose coordinates are absurd.
  quantFor(pos){
    let m = 0;
    for (let i = 0; i < pos.length; i++) { const a = Math.abs(pos[i]); if (a > m) m = a; }
    return Math.min(BakeMesh.QUANT, 1e9 / Math.max(1e-9, m));
  },
  // Signed curvature per COPY, in 1/unit: positive where the surface bends outward (a leading edge,
  // a fairing's crown, a rivet head), negative where it bends inward (a fillet, the foot of a
  // fairing, a panel joint), zero on a flat.
  //
  // The estimate is the classic one — along each triangle edge, how much the normal turns per unit
  // of distance, `dot(nB − nA, pB − pA) / |pB − pA|²` — averaged over the edges that meet at a
  // vertex. On a sphere of radius R that is 1/R along every edge, exactly (p = R·n, so both dot
  // products are R·|Δn|²), and on a cylinder it is 1/R around and 0 along; a flat gives 0.
  //
  // The normal used at a vertex is the MERGED one — the mean of every copy's normal at that
  // position — and that is what makes hard edges register at all. A box is six flat faces with
  // their own normals; edge-by-edge within a face every normal is the same and the curvature is
  // zero, so the crease would be invisible. With the merged normal at the crease the edge from a
  // face's interior to its rim turns by the corner's own angle, and the crease reads as the
  // convex spike it is, with a one-edge-wide falloff into each face — which is the width an edge-
  // wear mask wants. Where the copies disagree beyond reason (a fin modelled as two back-to-back
  // faces sums to nothing) each copy keeps its own normal instead, rather than turning noise into
  // curvature.
  curvature(pos, nrm, quant){
    const n = (pos.length / 3) | 0;
    quant = quant || BakeMesh.quantFor(pos);
    const { mid, count } = BakeMesh.weld(pos, quant);
    const ns = new Float32Array(count * 3), nc = new Int32Array(count);
    for (let i = 0; i < n; i++) {
      const m = mid[i];
      ns[m*3] += nrm[i*3]; ns[m*3+1] += nrm[i*3+1]; ns[m*3+2] += nrm[i*3+2]; nc[m]++;
    }
    const own = new Uint8Array(count);
    for (let m = 0; m < count; m++) {
      const l = Math.hypot(ns[m*3], ns[m*3+1], ns[m*3+2]);
      if (!(l >= .3 * nc[m])) { own[m] = 1; continue; }
      ns[m*3] /= l; ns[m*3+1] /= l; ns[m*3+2] /= l;
    }
    const acc = new Float64Array(count), cnt = new Int32Array(count);
    for (let t = 0; t + 2 < n; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = t + e, b = t + (e + 1) % 3;
        const ma = mid[a], mb = mid[b];
        if (ma === mb) continue;
        const dx = pos[b*3] - pos[a*3], dy = pos[b*3+1] - pos[a*3+1], dz = pos[b*3+2] - pos[a*3+2];
        const l2 = dx*dx + dy*dy + dz*dz;
        if (!(l2 > 1e-14)) continue;
        const ax = own[ma] ? nrm[a*3] : ns[ma*3], ay = own[ma] ? nrm[a*3+1] : ns[ma*3+1], az = own[ma] ? nrm[a*3+2] : ns[ma*3+2];
        const bx = own[mb] ? nrm[b*3] : ns[mb*3], by = own[mb] ? nrm[b*3+1] : ns[mb*3+1], bz = own[mb] ? nrm[b*3+2] : ns[mb*3+2];
        const k = ((bx - ax) * dx + (by - ay) * dy + (bz - az) * dz) / l2;
        if (k !== k) continue;                          // a zero normal somewhere in the file
        acc[ma] += k; cnt[ma]++; acc[mb] += k; cnt[mb]++;
      }
    }
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) { const m = mid[i]; out[i] = cnt[m] ? acc[m] / cnt[m] : 0; }
    return out;
  },
  // The magnitude that becomes "1" when a signed field is squashed into [−1, 1]: the 95th
  // percentile of the values that are not effectively zero. Curvature has no natural unit a mask
  // could use — a crease is 1/(edge length), a fuselage 1/(metres) — and the two sources the mask
  // combines (the mesh, and the normal map's texel-scale detail) are in different units entirely,
  // so each is normalised to its own spread before they meet. A histogram in log space rather than
  // a sort: a percentile to 1 % is all that is needed, over millions of values.
  scaleOf(vals, floor, mask){
    const BINS = 2048, LO = -6, HI = 6;
    const hist = new Int32Array(BINS);
    let total = 0;
    for (let i = 0; i < vals.length; i++) {
      if (mask && !mask[i]) continue;
      const a = Math.abs(vals[i]);
      if (!(a > floor)) continue;
      const b = Math.max(0, Math.min(BINS - 1, Math.floor((Math.log10(a) - LO) / (HI - LO) * BINS)));
      hist[b]++; total++;
    }
    if (!total) return 1;
    let seen = 0;
    for (let b = 0; b < BINS; b++) {
      seen += hist[b];
      if (seen >= total * .95) return Math.pow(10, LO + (b + 1) / BINS * (HI - LO));
    }
    return Math.pow(10, HI);
  },
  // `vals` squashed into [−1, 1] in place, by `scaleOf`.
  normalise(vals, floor){
    const s = BakeMesh.scaleOf(vals, floor);
    for (let i = 0; i < vals.length; i++) vals[i] = Math.max(-1, Math.min(1, vals[i] / s));
    return s;
  },
  // The normal map's own curvature: the divergence of its tangent-space normal, per texel. Where
  // the game's `_n` has a rivet or a panel line the mesh has nothing — that detail was baked into
  // the texture, not modelled — so a mesh-only curvature misses exactly the features an edge-wear
  // mask on a War Thunder vehicle is for. `nx`, `ny` are the map's two axes as bytes (128 = flat),
  // read in sheet orientation, y down. The sign follows the app's own emboss (decal-surface.js),
  // which writes n −= ∇h: across a bump nx runs negative→positive and so does ny down the sheet, so
  // ∂nx/∂x + ∂ny/∂y is positive on a bump and negative in a groove — convex positive, like the mesh.
  detail(nx, ny, w, h){
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const yu = y ? y - 1 : 0, yd = y < h - 1 ? y + 1 : y;
      for (let x = 0; x < w; x++) {
        const xl = x ? x - 1 : 0, xr = x < w - 1 ? x + 1 : x;
        out[y * w + x] = (nx[y * w + xr] - nx[y * w + xl]) + (ny[yd * w + x] - ny[yu * w + x]);
      }
    }
    return out;
  },
  // The 64 directions the occlusion bake looks from, and the frame each one is rendered in.
  // Shared with the shader by FORMULA — `Bake.AO_FS` computes the same Fibonacci sphere and the
  // same `up` rule from the loop index — so the depth map the JS side renders for direction i is
  // the one the fragment shader samples for direction i. Change one and the other must follow.
  N_DIRS: 64,
  dir(i, n){
    const z = 1 - (2 * i + 1) / n, r = Math.sqrt(Math.max(0, 1 - z * z)), phi = i * 2.399963229728653;
    return [r * Math.cos(phi), r * Math.sin(phi), z];
  },
  frame(d){
    const up = Math.abs(d[1]) < .9 ? [0, 1, 0] : [1, 0, 0];
    let t1 = [up[1] * d[2] - up[2] * d[1], up[2] * d[0] - up[0] * d[2], up[0] * d[1] - up[1] * d[0]];
    const l = Math.hypot(t1[0], t1[1], t1[2]);
    t1 = [t1[0] / l, t1[1] / l, t1[2] / l];
    const t2 = [d[1] * t1[2] - d[2] * t1[1], d[2] * t1[0] - d[0] * t1[2], d[0] * t1[1] - d[1] * t1[0]];
    return { t1, t2 };
  },
  // The position bake's three planes, padded and packed — `Bake.position`'s second half, and the
  // bake pool's `posPack`. `p0` / `p1` are the high and low bytes of each texel's place in the
  // vehicle's box and `p2` its normal, all RGBA straight off the GPU. Coverage is where p0 has
  // alpha; every plane is padded by the exporter's own seam pad (`padSeams`, the ENCODE section the
  // pool also carries) over that ONE coverage, so a padded texel's bytes all come from the same rim
  // texel; then the bytes become three Uint16 a texel, a flag, and three bytes of normal. In the
  // pool rather than on the UI thread (review of 4.50 (7), 2026-09-26): at 2048² over 400 islands
  // 45 % covered it held this thread 357–412 ms in one task — §3.1's seam padding, and twice
  // §3.5's 200 ms, under a bar that could neither repaint nor be cancelled while it ran.
  packPositions(p0, p1, p2, w, h, pad){
    const n = w * h, cov = new Uint8Array(n);
    for (let i = 0; i < n; i++) cov[i] = p0[i*4+3] ? 1 : 0;
    padSeams(p0, w, h, cov, pad);
    padSeams(p1, w, h, cov, pad);
    padSeams(p2, w, h, cov, pad);
    const pos = new Uint16Array(n * 3), has = new Uint8Array(n), nrm = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) {
      if (!p0[i*4+3]) continue;                        // neither covered nor padded
      has[i] = 1;
      pos[i*3]   = p0[i*4]   * 256 + p1[i*4];
      pos[i*3+1] = p0[i*4+1] * 256 + p1[i*4+1];
      pos[i*3+2] = p0[i*4+2] * 256 + p1[i*4+2];
      nrm[i*3] = p2[i*4]; nrm[i*3+1] = p2[i*4+1]; nrm[i*3+2] = p2[i*4+2];
    }
    return { cov, pos, has, nrm };
  },
};
/*==ENDBAKE==*/
// ---- the GPU half ----
// Both bakes end as one draw per part group into UV space, on the projector's own context and
// through its own per-part buffers (`projBuffers`, `projUVTiles`) — the GPU's exact fill rule
// covers each texel once, which is the property the projector was moved there for. What differs
// is the fragment: curvature carries a per-vertex value in as an attribute and writes it out;
// occlusion looks at the surface from 64 directions and asks each one's depth map whether
// anything is in the way. The shaders are properties of `Bake` rather than consts of their own —
// three fewer names in the one scope (§2).
const Bake = {
  VAL_VS: `
attribute vec2 aUV; attribute float aVal;
uniform float uFlipV; uniform vec2 uTile;
varying float vVal;
void main(){
  vVal = aVal;
  float v = uFlipV > .5 ? 1. - aUV.y : aUV.y;
  gl_Position = vec4((aUV.x - uTile.x) * 2. - 1., (v - uTile.y) * 2. - 1., 0., 1.);
}`,
  // Sixteen bits, not eight: the value is rescaled once more after the readback (see `curvature`),
  // and a byte stretched by a few times is a staircase.
  VAL_FS: `
precision highp float;
varying float vVal;
void main(){
  float v = clamp(vVal, 0., 1.) * (65535. / 65536.);
  float hi = floor(v * 255.);
  gl_FragColor = vec4(hi / 255., fract(v * 255.), 0., 1.);
}`,
  // Ambient occlusion as 64 shadow maps. Each direction on the sphere gets an orthographic depth
  // render of the whole vehicle (the projector's own depth pre-pass, `PROJD_*`), tiled into one atlas
  // so a single sampler serves the loop. A texel is lit from a direction when it is the first surface
  // that direction's ray meets, weighted by how squarely it faces it; the mean over the hemisphere is
  // the occlusion. Sixty-four directions is enough for a MASK — it is graded through levels and
  // softened, not lit by — and keeps the loop inside what GLSL ES 1.0 unrolls happily.
  AO_FS: `
precision highp float;
uniform sampler2D uAtlas;
uniform vec3 uC;
uniform float uR, uK, uEdge, uBias, uOff;
varying vec3 vPos; varying vec3 vNrm;
${PROJ_PACK}
vec3 fibDir(int i){
  float fi = float(i);
  float z = 1. - (2. * fi + 1.) / ${BakeMesh.N_DIRS}.;
  float r = sqrt(max(0., 1. - z * z));
  float phi = fi * 2.399963229728653;
  return vec3(r * cos(phi), r * sin(phi), z);
}
void main(){
  vec3 n = normalize(vNrm);
  // Stepped off the surface along its normal before the comparison: the standard cure for a
  // surface shadowing itself out of its own depth map's texel.
  vec3 q = vPos + n * uOff - uC;
  float occ = 0., wsum = 0.;
  for (int i = 0; i < ${BakeMesh.N_DIRS}; i++) {
    vec3 d = fibDir(i);
    float w = dot(n, d);
    if (w <= 0.) continue;
    vec3 up = abs(d.y) < .9 ? vec3(0., 1., 0.) : vec3(1., 0., 0.);
    vec3 t1 = normalize(cross(up, d));
    vec3 t2 = cross(d, t1);
    float u = dot(q, t1) / (2. * uR) + .5;
    float v = dot(q, t2) / (2. * uR) + .5;
    float t = .5 - dot(q, d) / (2. * uR);
    vec2 cell = vec2(mod(float(i), uK), floor((float(i) + .5) / uK));
    vec2 auv = (cell + clamp(vec2(u, v), uEdge, 1. - uEdge)) / uK;
    float near = unpackDepth(texture2D(uAtlas, auv));
    occ += w * (t <= near + uBias ? 1. : 0.);
    wsum += w;
  }
  float ao = wsum > 0. ? occ / wsum : 1.;
  gl_FragColor = vec4(vec3(ao), 1.);
}`,
  // Where each texel sits on the vehicle, for a gradient along the model (ROADMAP 4.44's fifth
  // candidate, editor/gradient.js). Each axis is written as a fraction of the vehicle's box in
  // sixteen bits, over two draws of the same geometry — the high bytes of x, y, z in one pass and
  // the low bytes in the next — because eight bits across a 20 m airframe is an 8 cm step, which is
  // a visible band on a fade over a wing chord, and 0.3 mm is not. Alpha is coverage, as in the
  // value pass. A THIRD draw (uLow = 2, 4.50 (7)) writes the interpolated vertex normal, a byte an
  // axis: a tri-planar pattern blends its three projections by it, and eight bits is a weight step
  // of under 1 % — the geometry's face normal (the cross product of the position map's own
  // derivatives) would have done without a pass, but it steps at every triangle edge, and those
  // steps would show as facets wherever two projections hand over on a curved surface.
  POS_FS: `
precision highp float;
uniform vec3 uB0, uB1;
uniform float uLow;
varying vec3 vPos; varying vec3 vNrm;
void main(){
  if (uLow > 1.5) { gl_FragColor = vec4(normalize(vNrm) * .5 + .5, 1.); return; }
  // the axis as a whole number 0…65535, split into its two bytes exactly: a byte written as b/255
  // comes back as b, so hi·256 + lo is the number on the JS side with nothing to rescale
  vec3 u = floor(clamp((vPos - uB0) / max(uB1 - uB0, vec3(1e-9)), 0., 1.) * 65535. + .5);
  vec3 hi = floor(u / 256.);
  vec3 lo = u - hi * 256.;
  gl_FragColor = vec4((uLow > .5 ? lo : hi) / 255., 1.);
}`,
  // Largest side a bake is rendered at. A mask does not need the sheet's every texel — it is
  // graded and softened before use — and 4096² is 64 MB read back once, against 268 MB at 8192².
  MAX_SIDE: 4096,
  // The position bake's own cap. A position varies smoothly across an island, so a gradient read
  // off a 2048² map at a 4096² sheet is exact to well under a texel, and the map is kept for as long
  // as a gradient along the model is on the sheet: three Uint16 per texel is 24 MB at this side,
  // against 96 MB at the mask bakes' cap.
  POS_SIDE: 2048,
  // How far the padded copy of a bake reaches into the gutters, in texels. `MaskBake`'s soften
  // blurs the VALUE before coverage is applied, and a blur that reached into an empty gutter would
  // fade every island's rim — the seam that shows on the model. 16 covers a soften of up to 8 px.
  PAD: 16,
  pool: null,
  workers(){
    if (Bake.pool) return Bake.pool;
    return Bake.pool = makeWorkerPool({
      name: "bake", size: 1, sections: ["BAKE", "ENCODE"],
      ops: `var WT_OPS = {
  curvature: function(a){
    var pos = new Float32Array(a.pos), nrm = new Float32Array(a.nrm);
    var k = BakeMesh.curvature(pos, nrm, 0);
    var scale = BakeMesh.normalise(k, 1e-4);
    return { __t: 1, result: { curv: k.buffer, scale: scale }, transfer: [k.buffer] };
  },
  posPack: function(a){
    var r = BakeMesh.packPositions(new Uint8ClampedArray(a.p0), new Uint8ClampedArray(a.p1), new Uint8ClampedArray(a.p2), a.w, a.h, a.pad);
    return { __t: 1, result: { cov: r.cov.buffer, pos: r.pos.buffer, has: r.has.buffer, nrm: r.nrm.buffer }, transfer: [r.cov.buffer, r.pos.buffer, r.has.buffer, r.nrm.buffer] };
  }
};` });
  },
  // Which part groups a bake paints: every group of this sheet, hidden or not — the mask is a
  // property of the model, and a part hidden to reach behind it still wants its own mask when it
  // comes back. Stores (4.38's loaded weapons) are not the vehicle and are left out of both sets.
  groups(slot){
    const out = [];
    if (!App.geomData || !slot) return out;
    for (const gd of App.geomData) {
      if (gd.weapon || App.matSlot.get(gd.mat) !== slot.id) continue;
      if (!gd.uv || !gd.normal || !gd.position) continue;
      out.push(gd);
    }
    return out;
  },
  // What casts shadow in the occlusion bake: the same rule as the projector's `projOccluders` —
  // everything the user can see, whatever sheet it is on, so a hidden gear door leaves the bay
  // open and a canopy still darkens the cockpit it covers.
  occluders(){
    const out = [];
    if (!App.geomData) return out;
    for (const gd of App.geomData) {
      if (gd.weapon || !gd.position) continue;
      const mesh = App.meshes.get(gd.name);
      if (mesh && !mesh.visible) continue;
      out.push(gd);
    }
    return out;
  },
  // A signature for what a bake depends on, so the dialog can keep one per sheet and know when it
  // is stale: the geometry object itself, the V flip, and — for occlusion — which parts are shown.
  key(slot, kind){
    // The position bake depends on the VEHICLE's groups and nothing else: `App.geomData` is a new
    // array every time a store is hung or taken down (game/stores.js), and a key on its length
    // re-baked 24 MB — and blanked every gradient for a frame — for a bomb that is not in the box.
    if (kind === "pos") return "pos|" + Bake.vehicleGeom().n + "|" + ($("optFlipV").checked ? "F" : "N") + "|" + slot.id;
    let k = (App.geomData ? App.geomData.length : 0) + "|" + ($("optFlipV").checked ? "F" : "N") + "|" + slot.id;
    if (kind === "ao") for (const gd of Bake.occluders()) k += "," + gd.name;
    return k;
  },
  // The vehicle's own geometry as an identity: its first non-weapon group (the objects survive a
  // loadout change, the array does not) and how many there are.
  vehicleGeom(){
    let first = null, n = 0;
    for (const gd of (App.geomData || [])) { if (gd.weapon || !gd.position) continue; if (!first) first = gd; n++; }
    return { first, n };
  },
  cached(slot, kind){
    const b = slot._bake && slot._bake[kind];
    if (!b || b.key !== Bake.key(slot, kind)) return null;
    return (kind === "pos" ? b.geom === Bake.vehicleGeom().first : b.geom === App.geomData) ? b : null;
  },
  progs(G){
    if (G.bake) return G.bake;
    const gl = G.gl;
    const sh = (type, srcTxt) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, srcTxt); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("bake shader: " + gl.getShaderInfoLog(s));
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
    const val = link(Bake.VAL_VS, Bake.VAL_FS, "curvature bake");
    const ao = link(PROJ_VS, Bake.AO_FS, "occlusion bake");
    const pos = link(PROJ_VS, Bake.POS_FS, "position bake");
    const u = (p, n) => gl.getUniformLocation(p, n);
    return G.bake = {
      val: { prog: val, a: { uv: gl.getAttribLocation(val, "aUV"), val: gl.getAttribLocation(val, "aVal") },
             u: { flipV: u(val, "uFlipV"), tile: u(val, "uTile") } },
      ao:  { prog: ao, a: { uv: gl.getAttribLocation(ao, "aUV"), pos: gl.getAttribLocation(ao, "aPos"), nrm: gl.getAttribLocation(ao, "aNrm") },
             u: { flipV: u(ao, "uFlipV"), tile: u(ao, "uTile"), atlas: u(ao, "uAtlas"), C: u(ao, "uC"), R: u(ao, "uR"),
                  K: u(ao, "uK"), edge: u(ao, "uEdge"), bias: u(ao, "uBias"), off: u(ao, "uOff") } },
      pos: { prog: pos, a: { uv: gl.getAttribLocation(pos, "aUV"), pos: gl.getAttribLocation(pos, "aPos"), nrm: gl.getAttribLocation(pos, "aNrm") },
             u: { flipV: u(pos, "uFlipV"), tile: u(pos, "uTile"), B0: u(pos, "uB0"), B1: u(pos, "uB1"), low: u(pos, "uLow") } },
    };
  },
  // The size a sheet is baked at: the sheet's own, capped by `side` (MAX_SIDE unless the bake says
  // otherwise) and by what this GPU will render into, with the aspect kept.
  size(G, slot, side){
    const gl = G.gl;
    const w = slot.composite.width, h = slot.composite.height;
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    const cap = Math.min(side || Bake.MAX_SIDE, G.maxTex, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), vp[0], vp[1]);
    const k = Math.min(1, cap / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  },
  // An RGBA8 colour target of the given size, with a depth buffer only when asked for (the atlas
  // needs one to keep the nearest surface; the UV passes draw without a depth test).
  target(gl, w, h, depth){
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let rb = null;
    if (depth) {
      rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) { gl.deleteTexture(tex); gl.deleteFramebuffer(fb); if (rb) gl.deleteRenderbuffer(rb); throw new Error("this GPU would not give the bake a " + w + "×" + h + " render target"); }
    return { fb, tex, rb, w, h, free(){ gl.deleteTexture(tex); gl.deleteFramebuffer(fb); if (rb) gl.deleteRenderbuffer(rb); } };
  },
  // The framebuffer's red channel and alpha, as sheet rows (GL reads bottom-up). Alpha is coverage:
  // the target is cleared to 0 and every fragment writes 1.
  readback(gl, w, h){
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const data = new Uint8Array(w * h), cov = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w, dst = y * w;
      for (let x = 0; x < w; x++) { data[dst + x] = px[(src + x) * 4]; cov[dst + x] = px[(src + x) * 4 + 3] ? 1 : 0; }
    }
    return { data, cov };
  },
  // The same, with R and G as one 16-bit value in [0, 1) — what the curvature pass writes.
  readback16(gl, w, h){
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const data = new Float32Array(w * h), cov = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w, dst = y * w;
      for (let x = 0; x < w; x++) {
        const k = (src + x) * 4;
        data[dst + x] = (px[k] * 255 + px[k + 1]) / 65280;
        cov[dst + x] = px[k + 3] ? 1 : 0;
      }
    }
    return { data, cov };
  },
  // The framebuffer as it is, RGBA, as sheet rows — for the position pass, whose three channels
  // are three axes and whose alpha is coverage.
  readbackRGBA(gl, w, h){
    const px = new Uint8Array(w * h * 4), out = new Uint8ClampedArray(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    return out;
  },
  // The box round the whole VEHICLE — every non-weapon group, shown or hidden — which is what a
  // gradient's `from` / `to` are fractions of (editor/gradient.js): the box has to be the same on
  // every sheet of the vehicle, or a fade would not meet itself where two sheets do.
  vehicleBounds(){
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const gd of (App.geomData || [])) {
      if (gd.weapon || !gd.position) continue;
      const bb = gdBounds(gd);
      x0 = Math.min(x0, bb.x0); y0 = Math.min(y0, bb.y0); z0 = Math.min(z0, bb.z0);
      x1 = Math.max(x1, bb.x1); y1 = Math.max(y1, bb.y1); z1 = Math.max(z1, bb.z1);
    }
    if (!(x1 >= x0)) return null;
    // a flat model still needs a box with some depth to it, or an axis divides by zero
    const pad = (a, b) => b - a > 1e-6 ? [a, b] : [a - 1e-3, b + 1e-3];
    [x0, x1] = pad(x0, x1); [y0, y1] = pad(y0, y1); [z0, z1] = pad(z0, z1);
    return { x0, y0, z0, x1, y1, z1 };
  },
  // One draw per part group per UV tile, the projector's own loop (4.23(a)): a part whose UVs run
  // past 1 is drawn once per whole sheet it crosses, translated, never folded.
  drawGroups(gl, groups, tileU, flipV, bind){
    for (const gd of groups) {
      bind(gd);
      const T = projUVTiles(gd, flipV);
      for (let ty = T.y0; ty <= T.y1; ty++) for (let tx = T.x0; tx <= T.x1; tx++) {
        gl.uniform2f(tileU, tx, ty);
        gl.drawArrays(gl.TRIANGLES, 0, gd.position.length / 3);
      }
    }
  },
  // Fill the gutters from the islands' rims, PAD texels deep, and store both the padded value and
  // the coverage. The exporter's own seam pad does it — the one reason this module loads after
  // export/encode.js — on an RGBA copy, because that is the shape it takes.
  pad(data, cov, w, h){
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { rgba[i*4] = data[i]; rgba[i*4+3] = 255; }
    padSeams(rgba, w, h, cov, Bake.PAD);
    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = rgba[i*4];
    return out;
  },
  // ---- curvature ----
  // Per-vertex curvature from the worker, squashed to [−1, 1]; rasterised into UV space as
  // 128 = flat; the normal map's own divergence added when the sheet has one (and the caller asks).
  async curvature(slot){
    const G = projGL();
    if (!G) throw new Error("no WebGL context — the bake needs the GPU projector");
    const groups = Bake.groups(slot);
    if (!groups.length) throw new Error("no part of the model uses this texture");
    const gl = G.gl, P = Bake.progs(G), { w, h } = Bake.size(G, slot);
    progress("Welding the mesh…", -1);
    let n = 0;
    for (const gd of groups) n += gd.position.length;
    const pos = new Float32Array(n), nrm = new Float32Array(n);
    let at = 0;
    for (const gd of groups) { pos.set(gd.position, at); nrm.set(gd.normal, at); at += gd.position.length; }
    const res = await Bake.workers().call("curvature", { pos: pos.buffer, nrm: nrm.buffer }, [pos.buffer, nrm.buffer]);
    const curv = new Float32Array(res.curv);
    throwIfCancelled();
    progress("Baking curvature…", .5);
    await progTick(true);
    const T = Bake.target(gl, w, h, false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(P.val.prog);
    const flip = $("optFlipV").checked;
    gl.uniform1f(P.val.u.flipV, flip ? 1 : 0);
    gl.enableVertexAttribArray(P.val.a.uv); gl.enableVertexAttribArray(P.val.a.val);
    let off = 0;
    const vbuf = gl.createBuffer();
    Bake.drawGroups(gl, groups, P.val.u.tile, flip, gd => {
      const cnt = gd.position.length / 3;
      // 128 = flat, in the byte the fragment writes: (k + 1) / 2 of the unit range
      const vals = new Float32Array(cnt);
      for (let i = 0; i < cnt; i++) vals[i] = (curv[off + i] + 1) * .5;
      off += cnt;
      const b = projBuffers(G, gd);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.uv); gl.vertexAttribPointer(P.val.a.uv, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbuf); gl.bufferData(gl.ARRAY_BUFFER, vals, gl.STREAM_DRAW);
      gl.vertexAttribPointer(P.val.a.val, 1, gl.FLOAT, false, 0, 0);
    });
    gl.disableVertexAttribArray(P.val.a.uv); gl.disableVertexAttribArray(P.val.a.val);
    gl.deleteBuffer(vbuf);
    const rb = Bake.readback16(gl, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    T.free();
    // Normalised twice, on purpose. The worker's scale is the spread over VERTICES, and a small,
    // densely-modelled part — a bracket, an antenna base — has thousands of them at 1/(a few mm)
    // while the wing's rim has a few hundred at 1/(a few cm), so the vertex percentile is set by
    // the brackets and every edge that covers real texels comes out dim. The spread over covered
    // TEXELS is what the eye sees, and it is what "1" is set to here; the brackets saturate, which
    // is what they are — one edge wide all over.
    const f = rb.data;
    for (let i = 0; i < f.length; i++) f[i] = f[i] * 2 - 1;
    const s1 = BakeMesh.scaleOf(f, .02, rb.cov);
    const mesh = new Uint8Array(w * h);
    for (let i = 0; i < f.length; i++) mesh[i] = rb.cov[i] ? Math.round(128 + 127 * Math.max(-1, Math.min(1, f[i] / s1))) : 0;
    const out = { kind: "curv", w, h, cov: rb.cov, mesh, detail: null, scale: res.scale * s1,
                  geom: App.geomData, key: Bake.key(slot, "curv") };
    if (slot.normal) {
      throwIfCancelled();
      progress("Reading the normal map…", .8);
      await progTick(true);
      out.detail = Bake.detailSheet(slot, w, h);
    }
    Bake.combine(out, !!out.detail);
    return out;
  },
  // The normal map's divergence at the bake's size, as a byte sheet with 128 = flat: the map's two
  // axes read straight off the slot's normal canvas (R = X, G = Y — channels.js `rawChanStore`),
  // differentiated at the map's own resolution, then normalised and resampled to the bake's.
  detailSheet(slot, w, h){
    const nc = slot.normal, nw = nc.width, nh = nc.height;
    const d = ctx2d(nc).getImageData(0, 0, nw, nh).data;
    const nx = new Float32Array(nw * nh), ny = new Float32Array(nw * nh);
    for (let i = 0; i < nw * nh; i++) { nx[i] = d[i*4]; ny[i] = d[i*4+1]; }
    const div = BakeMesh.detail(nx, ny, nw, nh);
    BakeMesh.normalise(div, 3);                        // below 3/255 per texel is the map's own noise
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(nh - 1, Math.floor(y * nh / h));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(nw - 1, Math.floor(x * nw / w));
        out[y * w + x] = Math.round(128 + 127 * div[sy * nw + sx]);
      }
    }
    return out;
  },
  // The two curvature sources as one byte sheet (128 = flat), padded into the gutters, set as the
  // bake's `data`. The dialog calls it again when the detail is toggled — no GPU work in that.
  combine(b, withDetail){
    const n = b.w * b.h, out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let v = b.mesh[i] - 128;
      if (withDetail && b.detail) v += b.detail[i] - 128;
      out[i] = Math.max(1, Math.min(255, 128 + v));
    }
    b.withDetail = withDetail && !!b.detail;
    b.data = Bake.pad(out, b.cov, b.w, b.h);
    return b.data;
  },
  // ---- occlusion ----
  async occlusion(slot){
    const G = projGL();
    if (!G) throw new Error("no WebGL context — the bake needs the GPU projector");
    const groups = Bake.groups(slot), occ = Bake.occluders();
    if (!groups.length) throw new Error("no part of the model uses this texture");
    const gl = G.gl, P = Bake.progs(G), { w, h } = Bake.size(G, slot);
    // The bounding sphere of everything that casts: every direction's orthographic view is a box
    // of that radius, so nothing is ever clipped out of a depth map.
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const gd of occ) {
      const bb = gdBounds(gd);
      x0 = Math.min(x0, bb.x0); y0 = Math.min(y0, bb.y0); z0 = Math.min(z0, bb.z0);
      x1 = Math.max(x1, bb.x1); y1 = Math.max(y1, bb.y1); z1 = Math.max(z1, bb.z1);
    }
    const C = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const R = Math.max(1e-3, Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2);
    // The atlas: K×K cells of S² each. The biggest square this GPU allows, so a cell is as fine as
    // it can be — 512² over a 20 m airframe is 4 cm a texel, the scale of the occlusion a mask wants.
    const N = BakeMesh.N_DIRS, K = Math.ceil(Math.sqrt(N));
    const side = Math.min(4096, G.maxTex, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    const S = Math.floor(side / K);
    const A = Bake.target(gl, S * K, S * K, true);
    let T = null, rb;
    // both targets are freed however this ends — a cancel mid-way must not leave 64 MB on the GPU
    try {
      progress("Rendering " + N + " depth maps…", 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, A.fb);
      gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
      gl.viewport(0, 0, A.w, A.h);
      gl.clearColor(1, 1, 1, 1); gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(G.dprog);
      gl.uniform3f(G.dU.P, C[0], C[1], C[2]);
      gl.uniform2f(G.dU.half, R, R);
      gl.uniform1f(G.dU.depth, R);
      gl.enableVertexAttribArray(G.da.pos);
      for (let i = 0; i < N; i++) {
        const d = BakeMesh.dir(i, N), { t1, t2 } = BakeMesh.frame(d);
        gl.viewport((i % K) * S, Math.floor(i / K) * S, S, S);
        gl.uniform3f(G.dU.N, d[0], d[1], d[2]);
        gl.uniform3f(G.dU.T1, t1[0], t1[1], t1[2]);
        gl.uniform3f(G.dU.T2, t2[0], t2[1], t2[2]);
        for (const gd of occ) {
          const b = projBuffers(G, gd);
          gl.bindBuffer(gl.ARRAY_BUFFER, b.pos);
          gl.vertexAttribPointer(G.da.pos, 3, gl.FLOAT, false, 0, 0);
          gl.drawArrays(gl.TRIANGLES, 0, b.n);
        }
        if ((i & 7) === 7) { progress(null, (i + 1) / N * .7); await progTick(true); throwIfCancelled(); }
      }
      gl.disableVertexAttribArray(G.da.pos);
      gl.disable(gl.DEPTH_TEST);
      progress("Baking occlusion…", .75);
      await progTick(true);
      T = Bake.target(gl, w, h, false);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(P.ao.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, A.tex);
      gl.uniform1i(P.ao.u.atlas, 0);
      gl.uniform3f(P.ao.u.C, C[0], C[1], C[2]);
      gl.uniform1f(P.ao.u.R, R);
      gl.uniform1f(P.ao.u.K, K);
      gl.uniform1f(P.ao.u.edge, .5 / S);
      // One depth-map texel of slack each way — as depth, in the map's own [0,1] over 2R, and as a
      // step off the surface along its normal — is what separates "the surface itself" from "the
      // panel 5 cm above it" at every angle a direction can meet a surface at.
      gl.uniform1f(P.ao.u.bias, 1 / S);
      gl.uniform1f(P.ao.u.off, 2 * R / S);
      const flip = $("optFlipV").checked;
      gl.uniform1f(P.ao.u.flipV, flip ? 1 : 0);
      gl.enableVertexAttribArray(P.ao.a.uv); gl.enableVertexAttribArray(P.ao.a.pos); gl.enableVertexAttribArray(P.ao.a.nrm);
      Bake.drawGroups(gl, groups, P.ao.u.tile, flip, gd => {
        const b = projBuffers(G, gd);
        gl.bindBuffer(gl.ARRAY_BUFFER, b.uv);  gl.vertexAttribPointer(P.ao.a.uv, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, b.pos); gl.vertexAttribPointer(P.ao.a.pos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, b.nrm); gl.vertexAttribPointer(P.ao.a.nrm, 3, gl.FLOAT, false, 0, 0);
      });
      gl.disableVertexAttribArray(P.ao.a.uv); gl.disableVertexAttribArray(P.ao.a.pos); gl.disableVertexAttribArray(P.ao.a.nrm);
      rb = Bake.readback(gl, w, h);
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (T) T.free();
      A.free();
    }
    return { kind: "ao", w, h, cov: rb.cov, data: Bake.pad(rb.data, rb.cov, w, h),
             geom: App.geomData, key: Bake.key(slot, "ao") };
  },
  // ---- position ----
  // Each texel's place on the vehicle, three Uint16 per texel interleaved (`pos`), as fractions of
  // the vehicle's box (`bb`); `has` is 1 where a texel holds one — an island, or the PAD texels of
  // gutter beside it, filled from the rim so a gradient's edge does not fray at a seam. Two draws
  // and two readbacks (POS_FS), both padded by the exporter's own seam pad on the same coverage, so
  // a padded texel's two bytes come from the same rim texel. A third draw is the NORMAL at each
  // texel (`nrm`, three bytes, 128 = 0), padded the same way — what a tri-planar pattern weighs its
  // projections by (4.50 (7)). 12 MB at 2048², kept and dropped with the rest of the bake. The
  // padding and packing run in the bake pool (`BakeMesh.packPositions`); this thread keeps the
  // draws and the readbacks, which need the GL context.
  async position(slot){
    const G = projGL();
    if (!G) throw new Error("no WebGL context — the bake needs the GPU projector");
    const groups = Bake.groups(slot);
    if (!groups.length) throw new Error("no part of the model uses this texture");
    const bb = Bake.vehicleBounds();
    if (!bb) throw new Error("the model has no geometry to place a gradient on");
    const gl = G.gl, P = Bake.progs(G), { w, h } = Bake.size(G, slot, Bake.POS_SIDE);
    progress("Baking positions…", .1);
    await progTick(true);
    const T = Bake.target(gl, w, h, false);
    const planes = [];
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.useProgram(P.pos.prog);
      const flip = $("optFlipV").checked;
      gl.uniform1f(P.pos.u.flipV, flip ? 1 : 0);
      gl.uniform3f(P.pos.u.B0, bb.x0, bb.y0, bb.z0);
      gl.uniform3f(P.pos.u.B1, bb.x1, bb.y1, bb.z1);
      gl.enableVertexAttribArray(P.pos.a.uv); gl.enableVertexAttribArray(P.pos.a.pos); gl.enableVertexAttribArray(P.pos.a.nrm);
      // All three passes back to back with nothing awaited between them: another bake queued
      // behind this one would otherwise bind its own target under this one's later draws.
      for (let pass = 0; pass < 3; pass++) {
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform1f(P.pos.u.low, pass);
        Bake.drawGroups(gl, groups, P.pos.u.tile, flip, gd => {
          const b = projBuffers(G, gd);
          gl.bindBuffer(gl.ARRAY_BUFFER, b.uv);  gl.vertexAttribPointer(P.pos.a.uv, 2, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, b.pos); gl.vertexAttribPointer(P.pos.a.pos, 3, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, b.nrm); gl.vertexAttribPointer(P.pos.a.nrm, 3, gl.FLOAT, false, 0, 0);
        });
        planes.push(Bake.readbackRGBA(gl, w, h));
      }
      gl.disableVertexAttribArray(P.pos.a.uv); gl.disableVertexAttribArray(P.pos.a.pos); gl.disableVertexAttribArray(P.pos.a.nrm);
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      T.free();
    }
    throwIfCancelled();
    progress("Padding the seams…", .7);
    await progTick(true);
    // padded and packed in the bake pool (`BakeMesh.packPositions`); a cancel pressed meanwhile
    // takes effect when the worker replies
    const r = await Bake.workers().call("posPack", { p0: planes[0].buffer, p1: planes[1].buffer, p2: planes[2].buffer, w, h, pad: Bake.PAD },
                                        [planes[0].buffer, planes[1].buffer, planes[2].buffer]);
    throwIfCancelled();
    return { kind: "pos", w, h, cov: new Uint8Array(r.cov), has: new Uint8Array(r.has), pos: new Uint16Array(r.pos), nrm: new Uint8Array(r.nrm),
             bb, geom: Bake.vehicleGeom().first, key: Bake.key(slot, "pos"), ser: ++Bake._ser };
  },
  LABEL: { ao: "Baking occlusion", curv: "Baking curvature", pos: "Baking positions" },
  _ser: 0,                                  // every position bake is a new one, whatever its key says
  // Run one bake under the progress bar and cache it on the slot; the cached one when it is current.
  async run(slot, kind){
    const have = Bake.cached(slot, kind);
    if (have) return have;
    if (App._projGL && App._projGL.gl && App._projGL.bytes > PROJ_GL_BUDGET) projGLFree();
    // Cancellable between phases (§3.5). The one phase that cannot be interrupted is the worker's
    // weld, so a cancel pressed during it takes effect when the worker replies — a second or two on
    // the largest airframe, never longer.
    progBegin(Bake.LABEL[kind] || "Baking", true);
    try {
      const b = kind === "ao" ? await Bake.occlusion(slot) : kind === "pos" ? await Bake.position(slot) : await Bake.curvature(slot);
      slot._bake = slot._bake || {};
      slot._bake[kind] = b;
      return b;
    } finally { progEnd(); }
  },
  // ---- a mask out of a bake ----
  // `mode` picks the sign — edges or cavities of a curvature bake, the occluded or the open half of
  // an occlusion bake — and `lo`/`hi` (0…1) are the levels: what reads as fully hidden and as fully
  // shown, with a straight ramp between. Returns the per-texel alpha at the bake's size, and the
  // coverage it should be cut to.
  grade(b, mode, lo, hi){
    const n = b.w * b.h, out = new Uint8Array(n);
    const span = Math.max(1e-3, hi - lo);
    for (let i = 0; i < n; i++) {
      const raw = b.data[i];
      let v;
      if (b.kind === "curv") v = mode === "cavities" ? (128 - raw) / 127 : (raw - 128) / 127;
      else v = mode === "open" ? raw / 255 : 1 - raw / 255;
      out[i] = Math.round(255 * Math.max(0, Math.min(1, (v - lo) / span)));
    }
    return out;
  },
  // The graded bake as a mask canvas at the sheet's size: value, blurred if asked, cut to the
  // islands last — so the blur reads the padded gutters rather than fading every rim.
  toMask(slot, b, mode, lo, hi, soften){
    const a = Bake.grade(b, mode, lo, hi);
    const c = mkCanvas(b.w, b.h), g = ctx2d(c);
    const img = g.createImageData(b.w, b.h);
    for (let i = 0; i < b.w * b.h; i++) { img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = a[i]; img.data[i*4+3] = 255; }
    g.putImageData(img, 0, 0);
    if (soften > 0) {
      const tmp = mkCanvas(b.w, b.h);
      ctx2d(tmp).drawImage(c, 0, 0);
      g.filter = "blur(" + soften + "px)";
      g.drawImage(tmp, 0, 0);
      g.filter = "none";
    }
    // luminance → alpha, and nothing in the gutters
    const d = g.getImageData(0, 0, b.w, b.h);
    for (let i = 0; i < b.w * b.h; i++) { d.data[i*4+3] = b.cov[i] ? d.data[i*4] : 0; d.data[i*4] = d.data[i*4+1] = d.data[i*4+2] = 255; }
    g.putImageData(d, 0, 0);
    const W = slot.composite.width, H = slot.composite.height;
    if (W === b.w && H === b.h) return c;
    const m = mkCanvas(W, H), mg = ctx2d(m);
    mg.imageSmoothingQuality = "high";
    mg.drawImage(c, 0, 0, W, H);
    return m;
  },
};
