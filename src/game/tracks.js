/*==TRACKS==*/
// ---- Tank tracks ----
// A War Thunder tank model contains the road wheels but not the track: the game generates the
// ribbon at runtime from the suspension nodes, which is why the track material has textures and
// no mesh. For the preview the ribbon is rebuilt the same way — the convex hull of the wheels
// on each side, offset by the wheel radii — so a track texture can actually be seen on the
// vehicle instead of being invisible or smeared onto whatever mesh happened to claim it.
function hull2d(pts){
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], q) <= 0) lower.pop(); lower.push(q); }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], q) <= 0) upper.pop(); upper.push(q); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}
function trackMaterialName(bind, model){
  if (!bind || !bind.materials) return null;
  const mk = model ? unitKey(model) : "";
  let best = null, bestScore = 0;
  for (let i = 0; i < bind.materials.length; i++) {
    const nm = descMatName(bind.materials[i]);
    if (!nm || !/track|caterpillar/i.test(nm) || /xray|dmg/i.test(nm)) continue;
    // "attch_…_track" is the spare links strapped to the hull, not the running track
    let score = /^(attch|spare)/i.test(nm) ? 1 : 5;
    if (mk && unitKey(nm).includes(mk)) score += 4;
    if (score > bestScore) { bestScore = score; best = nm; }
  }
  return best;
}
// ---------- The ribbon, as named steps on one object (ROADMAP 2.4) ----------
// `buildTrackGeometry` was 93 lines: measuring wheels, hulling them, orienting the loop, deciding
// how long one repeat of the sheet is, and emitting two faces of every quad — with eleven locals
// shared across all five. They are methods over one `Track` object, and the per-side work travels
// in a plain record rather than in a closure.
//
// `tools/t78_tracks.mjs` is the oracle, written before the split and shown to fail without the
// second face: it holds that the belt wraps every wheel, that it is two-sided, that it sits in the
// widest wheel's own z band, that U spans the belt and V is arc length, and that a side with two
// wheels is not a track. Until it existed the only thing that ran this was an install-dependent
// scout that printed what it found and asserted nothing.
const Track = {
  // Each `wheel_<side>…` object, as a centre, a radius and a width read off its own vertices.
  // Fewer than twelve vertices is a bolt or a cap, not a road wheel.
  wheels(geo){
    const out = { l: [], r: [] };
    for (const obj of geo.objects) {
      const m = /^wheel_(l|r)(_|$)/i.exec(obj.name);
      if (!m) continue;
      const vs = new Set();
      for (const g of obj.groups) for (const f of g.faces) for (const vi of f) vs.add(vi);
      if (vs.size < 12) continue;
      let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
      for (const vi of vs) {
        const v = geo.verts[vi]; if (!v) continue;
        x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]);
        y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[1]);
        z0 = Math.min(z0, v[2]); z1 = Math.max(z1, v[2]);
      }
      if (x1 < x0) continue;
      out[m[1].toLowerCase()].push({ name: obj.name, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2,
        r: Math.max(x1 - x0, y1 - y0) / 2, width: z1 - z0 });
    }
    return out;
  },
  // The belt's own plane and width: radius-weighted, because a big drive sprocket sits where the
  // track really runs and a small return roller does not.
  band(ws){
    const width = Math.max(...ws.map(w => w.width)) * 1.02;
    const z = ws.reduce((n, w) => n + w.cz * w.r, 0) / ws.reduce((n, w) => n + w.r, 0);
    return { width, z0: z - width / 2, z1: z + width / 2 };
  },
  // The loop: the convex hull of every wheel's rim, wound so the outward face is the one you see
  // from this side.
  path(ws){
    const pts = [];
    for (const w of ws) for (let i = 0; i < 40; i++) {
      const a = i / 40 * Math.PI * 2;
      pts.push([w.cx + Math.cos(a) * (w.r + 0.012), w.cy + Math.sin(a) * (w.r + 0.012)]);
    }
    let path = hull2d(pts);
    if (path.length < 6) return null;
    let area = 0;
    for (let i = 0; i < path.length; i++) { const a = path[i], b = path[(i + 1) % path.length]; area += a[0] * b[1] - b[0] * a[1]; }
    if (area < 0) path = path.reverse();
    return path;
  },
  // Arc length to each corner, and the loop's own length.
  arc(path){
    let len = 0;
    const dist = [0];
    for (let i = 1; i <= path.length; i++) {
      const a = path[i - 1], b = path[i % path.length];
      len += Math.hypot(b[0] - a[0], b[1] - a[1]);
      dist.push(len);
    }
    return { dist, len };
  },
  // How long one repeat of the sheet is along the belt. The game's track textures are a single
  // link tiled, and they are tiny and wide — ger_leopard_2a4_track_c is 64×16, us_m1a2_abrams
  // 64×16, ussr_t_34_1941 64×32 — with the long axis across the belt. So U spans the width and
  // one repeat along the loop is width × (texH / texW): 0.635 × 0.25 = 0.16 m on the Leopard,
  // against a real link pitch of about 0.18 m.
  repeat(bind, matName, width){ return Math.max(0.05, width * trackTexAspect(bind, matName)); },
  // Both faces. The belt used to be a single outward-facing strip, so the far side of the vehicle
  // showed the *back* of the near track: double-sided materials drew it, but with the normal
  // pointing the wrong way it lit as a dark band. The inner face is the same quad wound the other
  // way with the normal negated, which is also what makes the top and bottom runs read as a belt
  // rather than a cut-out.
  mesh(path, band, arc, baseRepeat){
    const n = path.length;
    const pos = new Float32Array(n * 12 * 3), nrm = new Float32Array(n * 12 * 3), uvA = new Float32Array(n * 12 * 2);
    const vRaw = new Float32Array(n * 12);                     // arc length per vertex, for retiling
    let o = 0, uo = 0, vi = 0;
    for (let i = 0; i < n; i++) {
      const a = path[i], b = path[(i + 1) % n];
      const da = arc.dist[i], db = arc.dist[i + 1];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const el = Math.hypot(ex, ey) || 1;
      const nx = ey / el, ny = -ex / el;                       // outward in the X-Y plane
      const quad = [
        [a[0], a[1], band.z0, 0, da], [b[0], b[1], band.z0, 0, db], [b[0], b[1], band.z1, 1, db],
        [a[0], a[1], band.z0, 0, da], [b[0], b[1], band.z1, 1, db], [a[0], a[1], band.z1, 1, da],
      ];
      const emit = (list, sx, sy) => {
        for (const [x, y, zz, u, d] of list) {
          pos[o] = x; pos[o+1] = y; pos[o+2] = zz;
          nrm[o] = sx; nrm[o+1] = sy; nrm[o+2] = 0;
          o += 3;
          uvA[uo] = u; uvA[uo+1] = d / baseRepeat; uo += 2;
          vRaw[vi++] = d;
        }
      };
      emit(quad, nx, ny);
      emit(quad.slice().reverse(), -nx, -ny);                  // inner face
    }
    return { pos, nrm, uvA, vRaw, tris: n * 4 };
  },
};
function buildTrackGeometry(geo, bind, model){
  const matName = trackMaterialName(bind, model);
  if (!matName) return [];
  const wheels = Track.wheels(geo);
  const out = [];
  for (const side of ["l", "r"]) {
    const ws = wheels[side];
    if (ws.length < 3) continue;
    const path = Track.path(ws);
    if (!path) continue;
    const band = Track.band(ws);
    const arc = Track.arc(path);
    const baseRepeat = Track.repeat(bind, matName, band.width);
    const m = Track.mesh(path, band, arc, baseRepeat);
    out.push({ name: "track_" + side + " (generated)", mat: matName, position: m.pos, normal: m.nrm, uv: m.uvA,
      tris: m.tris, generated: true, track: { vRaw: m.vRaw, baseRepeat, width: band.width, length: arc.len } });
  }
  return out;
}
// U spans the belt width, so one repeat along the belt should be width × (texH / texW).
function trackTexAspect(bind, matName){
  const ref = bind && bind.map && bind.map.get((matName || "").toLowerCase());
  const stem = ref && ref.c;
  const rec = stem && GameDB.stems && GameDB.stems.get(stem);
  const en = rec && (rec.tiers.base || rec.tiers.hq || rec.tiers.uhq);
  if (!en || !en.w || !en.h) return 1;
  return en.h / en.w;
}
/*==ENDTRACKS==*/
// Live re-tiling from the Track tiling slider — geometry stays, only V is rescaled.
function retileTracks(){
  if (!App.geomData) return;
  let touched = 0;
  for (const gd of App.geomData) {
    if (!gd.track) continue;
    const rep = gd.track.baseRepeat / Math.max(.05, App.trackTiling);
    for (let i = 0; i < gd.track.vRaw.length; i++) gd.uv[i * 2 + 1] = gd.track.vRaw[i] / rep;
    const mesh = App.meshes.get(gd.name);
    if (mesh) {
      const attr = mesh.geometry.getAttribute("uv");
      const flipV = $("optFlipV").checked;
      for (let i = 0; i < gd.track.vRaw.length; i++) attr.setY(i, flipV ? 1 - gd.uv[i * 2 + 1] : gd.uv[i * 2 + 1]);
      attr.needsUpdate = true;
      touched++;
    }
  }
  if (touched) { needsRender(); setStatus("Track tiling " + App.trackTiling.toFixed(2) + "× — preview only, tracks are generated in game", "ok"); }
}
