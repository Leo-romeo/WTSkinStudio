"use strict";
// ---------- The shape tool's path, drawn over the model (ROADMAP 6.1b) ----------
// The sheet draws its path in `PathUI.draw`; a path drawn on the model is drawn here, the way
// ProjHandles draws a projected decal's frame: unlit lines and screen-sized points over the view,
// without the depth test — a node sunk into a curved panel would be a node nobody can reach — rebuilt
// from `PathUI` on every rendered frame, so an orbit redraws it and nothing has to remember to.
//
// Every point is lifted from the path's plane back into the world at the depth its segment
// interpolates between its nodes' (`Path.flatten` carries it), so the line sits on the surface it was
// drawn on, as near as two surface hits can say.
//
// One new top-level binding, for the same reason ProjHandles is one: the frame loop in scene.js and
// the promo shot in shot.js both have to reach it, and it owns three.js objects that `PathUI`, a
// panel, should not.
const PathOverlay = {
  group: null, line: null, handles: null, nodes: null, first: null,
  shown: false,
  cap: 0,                // the line's buffer, in points; grown by doubling, never per frame
  build(){
    if (PathOverlay.group) return PathOverlay.group;
    const G = new THREE.Group(), color = new THREE.Color(0x5aa0ff).convertSRGBToLinear();   // Marquee.ACCENT
    const add = (o, order) => { o.renderOrder = order; o.frustumCulled = false; G.add(o); return o; };
    const geo = n => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3)); return g; };
    const lineMat = o => new THREE.LineBasicMaterial({ color, transparent: true, opacity: o, depthTest: false, depthWrite: false, toneMapped: false });
    const ptMat = (px, round) => new THREE.PointsMaterial({ size: px, sizeAttenuation: false, map: ProjHandles.face(round),
      transparent: true, alphaTest: .5, depthTest: false, depthWrite: false, toneMapped: false });
    PathOverlay.line = add(new THREE.Line(geo(2), lineMat(.95)), 1000);
    PathOverlay.handles = add(new THREE.LineSegments(geo(2), lineMat(.55)), 1000);
    PathOverlay.nodes = add(new THREE.Points(geo(1), ptMat(9, true)), 1001);
    // The first node of an open path is the one that closes it, so it is drawn bigger and square.
    PathOverlay.first = add(new THREE.Points(geo(1), ptMat(12, false)), 1002);
    // The selected node — what Delete takes (4.52 (2)) — bigger again, and round.
    PathOverlay.sel = add(new THREE.Points(geo(1), ptMat(15, true)), 1003);
    G.visible = false;
    scene.add(G);
    return (PathOverlay.group = G);
  },
  // Write `pts` into obj's position buffer, reallocating only when it has to grow.
  put(obj, pts){
    let a = obj.geometry.attributes.position;
    if (a.count < pts.length) {
      let n = Math.max(2, a.count);
      while (n < pts.length) n *= 2;
      obj.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      a = obj.geometry.attributes.position;
    }
    pts.forEach((v, i) => a.setXYZ(i, v.x, v.y, v.z));
    a.needsUpdate = true;
    obj.geometry.setDrawRange(0, pts.length);
  },
  hide(){ if (PathOverlay.group) PathOverlay.group.visible = false; PathOverlay.shown = false; },
  // Once per rendered frame, before the render (scene.js).
  sync(){
    const path = PathUI.path;
    if (!PathUI.on || !PathUI.frame || !path || !path.pts.length || !modelGroup || cam.fly) { PathOverlay.hide(); return; }
    PathOverlay.build();
    const lift = q => PathUI.lift(q[0], q[1], q[2]);
    const poly = Path.flatten(path, PathUI.TOL / PathUI.frame.dens).map(lift);
    if (path.closed && poly.length > 2) poly.push(poly[0]);
    const hs = [], ends = [];
    for (const n of path.pts) {
      const [ix, iy] = Path.inH(n), o = n.hx || n.hy, i = ix || iy;
      if (!o && !i) continue;
      const a = PathUI.lift(n.x + ix, n.y + iy, n.d), b = PathUI.lift(n.x + (n.hx || 0), n.y + (n.hy || 0), n.d);
      hs.push(a, b);
      // Handle ends ride with the nodes: the same round face, so a handle reads as something to grab.
      if (o) ends.push(b);
      if (i) ends.push(a);
    }
    PathOverlay.put(PathOverlay.line, poly);
    PathOverlay.put(PathOverlay.handles, hs);
    PathOverlay.handles.visible = hs.length > 0;
    const nodes = path.pts.map(n => PathUI.lift(n.x, n.y, n.d));
    PathOverlay.put(PathOverlay.nodes, nodes.concat(ends));
    PathOverlay.put(PathOverlay.first, [nodes[0]]);
    PathOverlay.first.visible = !path.closed && path.pts.length > 2;
    const sel = nodes[PathUI.sel];
    if (sel) PathOverlay.put(PathOverlay.sel, [sel]);
    PathOverlay.sel.visible = !!sel;
    PathOverlay.group.visible = true;
    PathOverlay.shown = true;
  },
};
