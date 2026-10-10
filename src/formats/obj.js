"use strict";
/*==OBJ==*/
function parseOBJ(text, onProgress){
  const pos = [], uv = [], uv1 = [];               // uv1: the camouflage's UV, from `#vt1` (export/obj.js)
  const groups = new Map();
  let curMat = "default", curName = "";
  const getGroup = () => {
    const key = curName + "\u0000" + curMat;
    if (!groups.has(key)) groups.set(key, { gname: curName, mat: curMat, v: [], t: [], faces: 0 });
    return groups.get(key);
  };
  let cur = getGroup();
  let hasVN = false;
  const n = text.length;
  let i = 0, line = 0;
  while (i < n) {
    let e = text.indexOf("\n", i);
    if (e === -1) e = n;
    const c0 = text.charCodeAt(i);
    if (c0 === 118) { // v
      const c1 = text.charCodeAt(i + 1);
      if (c1 === 32) {
        const parts = text.slice(i + 2, e).trim().split(/\s+/);
        pos.push(+parts[0], +parts[1], +parts[2]);
      } else if (c1 === 116) {
        const parts = text.slice(i + 3, e).trim().split(/\s+/);
        uv.push(+parts[0], +parts[1]);
      } else if (c1 === 110) hasVN = true;
    } else if (c0 === 35 && text.startsWith("#vt1 ", i)) {    // # — the only comment this reads
      const parts = text.slice(i + 5, e).trim().split(/\s+/);
      if (parts[0] === "-") uv1.push(NaN, NaN); else uv1.push(+parts[0], +parts[1]);
    } else if (c0 === 102 && text.charCodeAt(i + 1) === 32) { // f
      const parts = text.slice(i + 2, e).trim().split(/\s+/);
      const vi = [], ti = [];
      for (const p of parts) {
        const s1 = p.indexOf("/");
        if (s1 === -1) { vi.push(+p); ti.push(0); }
        else {
          vi.push(+p.slice(0, s1));
          const s2 = p.indexOf("/", s1 + 1);
          const tt = s2 === -1 ? p.slice(s1 + 1) : p.slice(s1 + 1, s2);
          ti.push(tt ? +tt : 0);
        }
      }
      for (let k = 2; k < vi.length; k++) {
        cur.v.push(vi[0], vi[k-1], vi[k]);
        cur.t.push(ti[0], ti[k-1], ti[k]);
        cur.faces++;
      }
    } else if (c0 === 117 && text.startsWith("usemtl", i)) {
      curMat = text.slice(i + 7, e).trim() || "default";
      cur = getGroup();
    } else if ((c0 === 103 || c0 === 111) && text.charCodeAt(i + 1) === 32) { // g / o — sub-mesh designations
      curName = text.slice(i + 2, e).trim();
      cur = getGroup();
    }
    i = e + 1; line++;
    if (onProgress && (line & 0xFFFF) === 0) onProgress(i / n);
  }
  groups.forEach((g, k) => { if (!g.faces) groups.delete(k); });
  return { pos, uv, uv1: uv1.length === uv.length ? uv1 : null, groups, hasVN };
}
function buildGeometryData(parsed){
  const { pos, uv, uv1 } = parsed;
  // One part's camouflage UV, de-indexed the way its `uv` is — or null when any corner has none (a
  // part drawn from a format without tc1 samples the camouflage through its own UV instead).
  const camoUvOf = t => {
    if (!uv1) return null;
    const out = new Float32Array(t.length * 2);
    for (let k = 0; k < t.length; k++) {
      const ti = t[k] - 1, u = uv1[ti*2], v = uv1[ti*2+1];
      if (!(ti >= 0) || u !== u || v !== v) return null;        // NaN: this corner's format has no tc1
      out[k*2] = u; out[k*2+1] = v;
    }
    return out;
  };
  let groups = [...parsed.groups.values()];
  if (groups.length > 2500) { // safety: collapse to per-material if the obj is absurdly fragmented
    const byMat = new Map();
    for (const g of groups) {
      let m = byMat.get(g.mat);
      if (!m) byMat.set(g.mat, m = { gname: "", mat: g.mat, v: [], t: [] });
      for (const x of g.v) m.v.push(x);
      for (const x of g.t) m.t.push(x);
    }
    groups = [...byMat.values()];
  }
  const vCount = pos.length / 3;
  const acc = new Float32Array(vCount * 3);
  for (const g of groups) {
    const tri = g.v.length / 3;
    for (let f = 0; f < tri; f++) {
      const a = g.v[f*3] - 1, b = g.v[f*3+1] - 1, c = g.v[f*3+2] - 1;
      const ax = pos[a*3], ay = pos[a*3+1], az = pos[a*3+2];
      const ux = pos[b*3] - ax, uy = pos[b*3+1] - ay, uz = pos[b*3+2] - az;
      const vx = pos[c*3] - ax, vy = pos[c*3+1] - ay, vz = pos[c*3+2] - az;
      const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
      acc[a*3] += nx; acc[a*3+1] += ny; acc[a*3+2] += nz;
      acc[b*3] += nx; acc[b*3+1] += ny; acc[b*3+2] += nz;
      acc[c*3] += nx; acc[c*3+1] += ny; acc[c*3+2] += nz;
    }
  }
  for (let i = 0; i < vCount; i++) {
    const x = acc[i*3], y = acc[i*3+1], z = acc[i*3+2];
    const l = Math.hypot(x, y, z) || 1;
    acc[i*3] = x/l; acc[i*3+1] = y/l; acc[i*3+2] = z/l;
  }
  // unique display names: obj group designation when present, material otherwise
  const nameCount = new Map();
  for (const g of groups) {
    const base = g.gname || g.mat;
    nameCount.set(base, (nameCount.get(base) || 0) + 1);
  }
  const used = new Map();
  const result = [];
  for (const g of groups) {
    const base = g.gname || g.mat;
    let name = base;
    if (nameCount.get(base) > 1 && g.gname && g.gname !== g.mat) name = base + " (" + g.mat + ")";
    const seen = used.get(name) || 0;
    used.set(name, seen + 1);
    if (seen) name = name + " #" + (seen + 1);
    const tri = g.v.length;
    const position = new Float32Array(tri * 3);
    const normal = new Float32Array(tri * 3);
    const uvArr = new Float32Array(tri * 2);
    for (let k = 0; k < tri; k++) {
      const vi = g.v[k] - 1, ti = g.t[k] - 1;
      position[k*3] = pos[vi*3]; position[k*3+1] = pos[vi*3+1]; position[k*3+2] = pos[vi*3+2];
      normal[k*3] = acc[vi*3]; normal[k*3+1] = acc[vi*3+1]; normal[k*3+2] = acc[vi*3+2];
      if (ti >= 0) { uvArr[k*2] = uv[ti*2]; uvArr[k*2+1] = uv[ti*2+1]; }
    }
    const camoUv = camoUvOf(g.t);
    result.push({ name, mat: g.mat, position, normal, uv: uvArr, tris: tri / 3, skinned: !!g.skinned,
      ...(camoUv ? { camoUv } : {}) });
    g.v = null; g.t = null;
  }
  return result;
}
function matchTexture(matName, texStems){
  const tries = [matName];
  const tokens = matName.split("_");
  for (let cut = 1; cut < tokens.length; cut++) tries.push(tokens.slice(0, tokens.length - cut).join("_"));
  for (const t of tries) { if (texStems.has(t + "_c")) return { stem: t, c: t + "_c", n: texStems.has(t + "_n") ? t + "_n" : null }; }
  for (const t of tries) { if (texStems.has(t)) return { stem: t, c: t, n: texStems.has(t + "_n") ? t + "_n" : null }; }
  return null;
}
/*==ENDOBJ==*/
