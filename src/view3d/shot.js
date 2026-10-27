"use strict";
// ---------- A promo image: the model at high resolution over nothing (ROADMAP 4.37) ----------
// "A PNG with a transparent background, and semi-transparent shadows and glass, so it drops onto
// another image cleanly." The viewport's canvas has no alpha channel (a WebGLRenderer made with
// `alpha: false`, which is what keeps the hangar background cheap), so the shot is not a read of
// the screen: it is one render into a WebGLRenderTarget — which has alpha whatever the canvas has
// — with the background off and a clear alpha of 0, read back in the same frame.
//
// **The shadow needs a receiver, and the receiver must not appear.** A `ShadowMaterial` plane
// under the model writes only the shadow's alpha, which is exactly "a semi-transparent shadow over
// transparency". Shadows are otherwise off in the app — turning them on recompiles every material
// with the shadow-map defines, a few hundred ms the first time and cached after — so they are on
// for this one render and off again.
//
// **Supersampled, not multisampled.** A render target at r128 has no MSAA, so the render is made
// at up to twice the asked-for size and scaled down through a canvas, four taps per output pixel.
// The interface — the selection overlay, the brush ring, the mirror plane — is hidden for the
// frame and put back. "True to the game" is a shader question and not a resolution one (the item
// says so); this is the app's own shading, at a size the screen cannot show.
const Shot = {
  // The largest square the GPU will render to, so an ask past it is clamped rather than refused
  // with a driver error nobody can read.
  maxSide(){ return renderer ? Math.min(renderer.capabilities.maxTextureSize, 16384) : 4096; },
  // The render itself. Returns a canvas of exactly w x h with straight (not premultiplied) alpha.
  // `opt.frame` ({vw, vh, x, y, w, h}, the view's pixels) renders only that rectangle of the view as
  // the camera sees it now — the Market preview's 16:9 box (ROADMAP 4.50 (13)) — through the
  // camera's view offset, so what lands in the file is exactly what the frame drew round; without
  // one, the camera's own aspect is replaced by the image's, which is what the size presets want.
  // `opt.opaque` keeps the view's background instead of clearing to transparency.
  render(w, h, opt){
    opt = opt || {};
    if (!renderer || !modelGroup) return null;
    const max = Shot.maxSide();
    const ss = (w * 2 <= max && h * 2 <= max) ? 2 : 1;                 // supersample where the GPU allows
    const W = Math.min(max, w * ss), H = Math.min(max, h * ss);
    const rt = new THREE.WebGLRenderTarget(W, H, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: false });
    rt.texture.encoding = THREE.sRGBEncoding;                           // what the screen gets (r128 reads the target's encoding, not outputEncoding)
    const was = {
      bg: scene.background, clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(),
      aspect: camera.aspect, shadows: renderer.shadowMap.enabled, cast: App.keyLight ? App.keyLight.castShadow : false,
      hidden: [],
    };
    // the shadow catcher: a plane at the model's lowest point, three model-widths across
    const box = new THREE.Box3().setFromObject(modelGroup);
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const R = Math.max(s.x, s.y, s.z);
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(R * 3, R * 3),
      new THREE.ShadowMaterial({ opacity: .38, transparent: true, depthWrite: false }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.set(c.x, box.min.y - R * .002, c.z);
    catcher.receiveShadow = true;
    catcher.userData.effect = true;                                     // never a paint or pick target
    let out = null;
    const casters = [];
    try {
      if (!opt.opaque) { scene.background = null; renderer.setClearColor(0x000000, 0); }
      // the interface, off for the frame
      for (const o of SelOverlay.meshes) if (o.visible) { o.visible = false; was.hidden.push(o); }
      if (typeof brushRing !== "undefined" && brushRing && brushRing.visible) { brushRing.visible = false; was.hidden.push(brushRing); }
      if (typeof symPlaneMesh !== "undefined" && symPlaneMesh && symPlaneMesh.visible) { symPlaneMesh.visible = false; was.hidden.push(symPlaneMesh); }
      if (ProjHandles.group && ProjHandles.group.visible) { ProjHandles.group.visible = false; was.hidden.push(ProjHandles.group); }
      if (PathOverlay.group && PathOverlay.group.visible) { PathOverlay.group.visible = false; was.hidden.push(PathOverlay.group); }
      // shadows, for this frame: the key light casts over the whole model, every part casts
      const key = App.keyLight;
      if (key) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.bias = -0.0005;
        const sc = key.shadow.camera;
        sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = .1; sc.far = R * 6;
        sc.updateProjectionMatrix();
        key.target.position.copy(c); key.target.updateMatrixWorld();
        // the light sits where applyLightDir put it, relative to the origin; keep its direction
        // but centre it on the model so the shadow camera covers the whole vehicle
        was.lightPos = key.position.clone();
        key.position.copy(c).add(was.lightPos.clone().normalize().multiplyScalar(R * 3));
        for (const m of App.meshes.values()) if (m.visible && !m.userData.effect && !m.castShadow) { m.castShadow = true; casters.push(m); }
      }
      scene.add(catcher);
      const F = opt.frame;
      if (F) { camera.aspect = F.vw / F.vh; camera.setViewOffset(F.vw, F.vh, F.x, F.y, F.w, F.h); }
      else camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, camera);
      const px = new Uint8Array(W * H * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
      // GL rows run bottom-up; ImageData runs top-down
      const big = mkCanvas(W, H);
      const img = ctx2d(big).createImageData(W, H);
      const row = W * 4;
      for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * row, (H - y) * row), y * row);
      ctx2d(big).putImageData(img, 0, 0);
      if (ss === 1) out = big;
      else { out = mkCanvas(w, h); const g = ctx2d(out); g.imageSmoothingQuality = "high"; g.drawImage(big, 0, 0, w, h); }
    } finally {
      // Here, not after the read: a render or readback that threw left the renderer bound to the
      // disposed target and the live view drawing off screen (review of 4.50 (13); it predates it).
      renderer.setRenderTarget(null);
      for (const m of casters) m.castShadow = false;
      scene.remove(catcher); catcher.geometry.dispose(); catcher.material.dispose();
      rt.dispose();
      scene.background = was.bg;
      renderer.setClearColor(was.clear, was.alpha);
      renderer.shadowMap.enabled = was.shadows;
      if (App.keyLight) { App.keyLight.castShadow = was.cast; if (was.lightPos) App.keyLight.position.copy(was.lightPos); }
      for (const o of was.hidden) o.visible = true;
      if (opt.frame) camera.clearViewOffset();
      camera.aspect = was.aspect; camera.updateProjectionMatrix();
      needsRender();
    }
    return out;
  },
  // The whole command: ask the size, render, hand the file over the way an export goes out.
  // Answers "market" when the Market preview was picked: that one is framed first, by the 3-D
  // view's own frame (`ShotFrame`, ui/panels/view.js), and written by `market` below.
  async take(){
    if (!modelGroup || !renderer) { setStatus("Load a vehicle first — there is nothing to photograph", "err"); return; }
    const wrap = $("view3dwrap");
    const vw = Math.max(1, wrap.clientWidth), vh = Math.max(1, wrap.clientHeight);
    const max = Shot.maxSide();
    const fit = k => { const s = Math.min(k, max / vw, max / vh); return { w: Math.round(vw * s), h: Math.round(vh * s), k: s }; };
    const opts = [2, 4, 1].map(fit);
    const pick = await choiceDialog("Screenshot — a PNG with a transparent background and a soft shadow under the vehicle, framed as the 3-D view is now.\n\nHow large?",
      [{ label: opts[0].w + " × " + opts[0].h + " (2×)", value: 0, primary: true },
       { label: opts[1].w + " × " + opts[1].h + " (4×)", value: 1 },
       { label: opts[2].w + " × " + opts[2].h + " (as shown)", value: 2 },
       { label: "Market preview — " + Shot.MARKET.w + " × " + Shot.MARKET.h + " (16:9)…", value: "market" },
       { label: "Cancel", value: "cancel" }]);
    if (pick === "cancel" || pick == null) return;
    if (pick === "market") return "market";
    const { w, h } = opts[pick];
    await Shot.write(w, h, null, "", "transparent background, shadow under the vehicle");
  },
  // ROADMAP 4.50 (13). The WT Live market shows a skin by a 16:9 picture. 1920 × 1080 because it is
  // the common 16:9 size and the Market scales it down for its cards; on the view's own background
  // rather than transparent, because a card is a picture of the vehicle somewhere, not a cut-out.
  MARKET: { w: 1920, h: 1080 },
  market(frame){
    return Shot.write(Shot.MARKET.w, Shot.MARKET.h, { frame, opaque: true }, "_market",
      "16:9 for the WT Live market, framed as the box showed it");
  },
  async write(w, h, opt, tag, what){
    progBegin("Rendering " + w + " × " + h + "…", false);
    await progTick(true);
    try {
      const cv = Shot.render(w, h, opt);
      if (!cv) throw new Error("nothing rendered");
      const blob = await new Promise(res => cv.toBlob(res, "image/png"));
      if (!blob) throw new Error("the browser could not encode the PNG");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (($("skinName").value.trim() || App.vehicleKey || "vehicle").replace(/[^a-z0-9_\-]/gi, "_")) + tag + "_" + w + "x" + h + ".png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setStatus("Written " + a.download + " — " + what, "ok");
      return true;
    } catch (e) { reportFailure("taking a screenshot", e, "shot"); }
    finally { progEnd(); }
  },
};
