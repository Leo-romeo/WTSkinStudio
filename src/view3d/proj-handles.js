"use strict";
// ---------- A projected decal's handles, in the 3-D view (ROADMAP 4.2) ----------
// Since 4.35(1) the selected decal's footprint is drawn on the model (SelOverlay); what the item
// still asked for was "corner handles and an aim indicator drawn in the viewport, so size and
// rotation are direct manipulation rather than sliders". Drawn over that footprint:
//
//   * **the frame** — the projector's image rectangle, through its four corners, which carry
//     **square handles** that resize it about its centre;
//   * **a round knob** on a stalk off the image's top edge, which turns it; the stalk is also the
//     only thing on screen that says which way is UP in the image;
//   * **the aim** — the beam's axis, from the centre back towards where the projector stands, as far
//     as the Depth reaches (`projDepthLim`), with a cross at the centre. After an orbit this is the
//     one cue that the decal is still aimed from the view it was placed in, which is what
//     *Re-aim from this view* changes.
//
// Every position is a vector sum of the projector's own frame (`ProjGrip.frame`), so the overlay
// cannot disagree with the pixels, and the whole of it is rebuilt from `P` on every rendered frame:
// ten points, no canvas, no upload — the same "derived state, rebuilt where the frame is drawn"
// SelOverlay keeps. The corners of a decal on a curved panel stand off the surface, and they should:
// the projector's rectangle IS a plane. That is why everything here is drawn without the depth test —
// a corner hidden inside a fuselage would be a handle nobody can reach.
//
// The handles are screen-sized (PointsMaterial without attenuation), the knob stands a fixed
// ProjGrip.KNOB pixels off the edge whatever the zoom, and a decal too small on screen to carry them
// (ProjGrip.MIN) gets none, so a press on it is always the decal and never a handle drawn over it.
const ProjHandles = {
  PX: 9,                  // a handle's size on screen, CSS px
  HIT: 10,                // how near a press has to land to take one, CSS px
  group: null, frame: null, stalk: null, aim: null, corners: null, knob: null,
  shown: null,            // what the last frame drew, in client pixels — the hit test reads this
  hover: null,            // the handle under the pointer, for the cursor

  // Which decal carries handles right now: the one both views have in hand (`ProjGrip.target` —
  // painting off, no other placing mode armed), while there is a model and the camera is not flying.
  target(){
    if (!modelGroup || cam.fly) return null;
    return ProjGrip.target();
  },
  // A 16×16 handle face — white inside the accent colour — as data rather than a canvas: nothing
  // here needs the DOM, and a DataTexture is uploaded once.
  face(round){
    const N = 16, d = new Uint8Array(N * N * 4), A = [0x5a, 0xa0, 0xff];   // Marquee.ACCENT
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const cx = x + .5 - N / 2, cy = y + .5 - N / 2;
      const r = round ? Math.hypot(cx, cy) : Math.max(Math.abs(cx), Math.abs(cy));
      if (r > N / 2) continue;
      const i = (y * N + x) * 4, edge = r > N / 2 - 3.5;
      d[i] = edge ? A[0] : 255; d[i + 1] = edge ? A[1] : 255; d[i + 2] = edge ? A[2] : 255; d[i + 3] = 255;
    }
    const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
    t.encoding = THREE.sRGBEncoding;
    t.needsUpdate = true;
    return t;
  },
  build(){
    if (ProjHandles.group) return ProjHandles.group;
    const G = new THREE.Group();
    // Unlit and on top: an interface element, like the brush ring. `frustumCulled` off because the
    // positions are rewritten every frame and a stale bounding sphere would cull them at the edge.
    const color = new THREE.Color(0x5aa0ff).convertSRGBToLinear();
    const add = (o, order) => { o.renderOrder = order; o.frustumCulled = false; G.add(o); return o; };
    const lines = (n, opacity) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      return add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity,
        depthTest: false, depthWrite: false, toneMapped: false })), 1000);
    };
    const points = (n, round) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      return add(new THREE.Points(geo, new THREE.PointsMaterial({ size: ProjHandles.PX, sizeAttenuation: false,
        map: ProjHandles.face(round), transparent: true, alphaTest: .5, depthTest: false, depthWrite: false,
        toneMapped: false })), 1001);
    };
    ProjHandles.frame = lines(8, .95);       // four edges
    ProjHandles.stalk = lines(2, .95);       // top edge → knob
    ProjHandles.aim = lines(6, .7);          // the beam's axis, and the cross at the centre
    ProjHandles.corners = points(4, false);
    ProjHandles.knob = points(1, true);
    G.visible = false;
    scene.add(G);
    return (ProjHandles.group = G);
  },
  hide(){
    if (ProjHandles.group) ProjHandles.group.visible = false;
    ProjHandles.shown = null;
    ProjHandles.hover = null;
  },
  put(obj, pts){
    const a = obj.geometry.attributes.position;
    pts.forEach((v, i) => a.setXYZ(i, v.x, v.y, v.z));
    a.needsUpdate = true;
  },
  // Called once per rendered frame, before the render (scene.js). Screen positions are kept for the
  // hit test in the same pass, so a press is tested against exactly what is on screen.
  sync(){
    const L = ProjHandles.target();
    const r = L ? cnv3.getBoundingClientRect() : null;
    if (!L || !(r.width > 0 && r.height > 0)) { ProjHandles.hide(); return; }
    const F = ProjGrip.frame(L.proj);
    const scr = v => { const q = v.clone().project(camera); return { x: r.left + (q.x * .5 + .5) * r.width, y: r.top + (-q.y * .5 + .5) * r.height, z: q.z }; };
    const cw = ProjGrip.corners(F), top = ProjGrip.top(F);
    const sc = cw.map(scr), st = scr(top), s0 = scr(F.p);
    // Behind the camera, or too small on screen for a handle to be anything but in the way.
    const span = Math.max(...sc.map(s => Math.hypot(s.x - s0.x, s.y - s0.y)));
    if (sc.some(s => !(s.z < 1)) || !(st.z < 1) || !(s0.z < 1) || !(span >= ProjGrip.MIN)) { ProjHandles.hide(); return; }
    // The knob: a fixed distance past the top edge ON SCREEN, then back into the world at that edge's
    // own depth — so it keeps its distance at every zoom instead of shrinking into the frame.
    let dx = st.x - s0.x, dy = st.y - s0.y;
    const dl = Math.hypot(dx, dy);
    if (dl < 1) { dx = 0; dy = -1; } else { dx /= dl; dy /= dl; }
    const sk = { x: st.x + dx * ProjGrip.KNOB, y: st.y + dy * ProjGrip.KNOB };
    const kw = new THREE.Vector3((sk.x - r.left) / r.width * 2 - 1, 1 - (sk.y - r.top) / r.height * 2, st.z).unproject(camera);
    const reach = projDepthLim(L.proj, F.halfW, F.halfH), tick = Math.min(F.halfW, F.halfH) * .18;
    ProjHandles.build();
    ProjHandles.put(ProjHandles.frame, [cw[0], cw[1], cw[1], cw[2], cw[2], cw[3], cw[3], cw[0]]);
    ProjHandles.put(ProjHandles.stalk, [top, kw]);
    ProjHandles.put(ProjHandles.aim, [F.p, F.p.clone().addScaledVector(F.n, reach),
      ProjGrip.at(F, -tick, 0), ProjGrip.at(F, tick, 0), ProjGrip.at(F, 0, -tick), ProjGrip.at(F, 0, tick)]);
    ProjHandles.put(ProjHandles.corners, cw);
    ProjHandles.put(ProjHandles.knob, [kw]);
    ProjHandles.group.visible = true;
    ProjHandles.shown = { L, P: L.proj, corners: sc, knob: sk, centre: s0 };
  },
  // The handle under a client-space point, or null: `{ kind: "scale", i }` for corner i (image order,
  // TL TR BR BL), `{ kind: "rot" }` for the knob. The nearest wins inside HIT pixels. It asks target()
  // again, so a press after painting was switched on — but before the next frame hid the handles —
  // still reaches the brush.
  hit(x, y){
    const S = ProjHandles.shown;
    if (!S || ProjHandles.target() !== S.L || S.L.proj !== S.P) return null;
    let best = null, bd = ProjHandles.HIT;
    const dk = Math.hypot(x - S.knob.x, y - S.knob.y);
    if (dk <= bd) { best = { kind: "rot" }; bd = dk; }
    S.corners.forEach((c, i) => { const d = Math.hypot(x - c.x, y - c.y); if (d <= bd) { best = { kind: "scale", i }; bd = d; } });
    return best;
  },
  // The pointer's ray, the same mapping `ray3d` casts along.
  ray(e){
    const r = cnv3.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    return { o: raycaster.ray.origin.clone(), d: raycaster.ray.direction.clone() };
  },
  // What the cursor says over (or while dragging) a handle: the resize arrow that runs along that
  // corner's diagonal as it is ON SCREEN, and for the knob a drawn turn — there is no CSS cursor for
  // rotation, so it is an inline SVG like the rest of the app's icons (§4), with `grab` behind it.
  ROT: 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    '<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18.5 9A7 7 0 1 0 19 15" stroke="#fff" stroke-width="4"/>' +
    '<path d="M18.5 3.5V9H13" stroke="#fff" stroke-width="4"/><path d="M18.5 9A7 7 0 1 0 19 15" stroke="#111" stroke-width="1.8"/>' +
    '<path d="M18.5 3.5V9H13" stroke="#111" stroke-width="1.8"/></g></svg>') + '") 12 12, grab',
  cursor(h){
    if (!h) return "";
    if (h.kind === "rot") return ProjHandles.ROT;
    const S = ProjHandles.shown, c = S && S.corners[h.i];
    if (!c) return "nwse-resize";
    return (c.x - S.centre.x) * (c.y - S.centre.y) > 0 ? "nwse-resize" : "nesw-resize";
  },
};
