function buildScene(){
  if (!App.geomData) return;
  disposeModelGroup();
  modelGroup = new THREE.Group();
  App.meshes.clear();
  App._nodeParts = null;                    // the node → parts index is rebuilt with the scene
  const flipV = $("optFlipV").checked;
  for (const g of App.geomData) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(g.position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(g.normal, 3));
    const uvArr = flipV ? flipUVs(g.uv) : g.uv;
    const uvAttr = new THREE.BufferAttribute(uvArr, 2);
    geo.setAttribute("uv", uvAttr);
    // The camo blend needs a second and third texture on the same material, and three.js r128
    // only offers lightMap/aoMap for that — both of which sample vUv2. Same coordinates here.
    geo.setAttribute("uv2", uvAttr);
    // The camouflage's own UV (tc1, ROADMAP 4.50 (6)): the game lays t1 through it, not through the
    // albedo's UV. Kept un-transformed on the mesh, because the preview's scale and rotation are
    // re-applied to it on every slider move (CamoTile.applyView).
    const camoUv0 = g.camoUv ? (flipV ? flipUVs(g.camoUv) : g.camoUv) : null;
    if (camoUv0) geo.setAttribute("camoUv", new THREE.BufferAttribute(CamoTile.xform(camoUv0), 2));
    const mat = makeMaterial(g.mat, g.name, geo);
    const mesh = new THREE.Mesh(geo, mat);
    if (camoUv0) mesh.userData.camoUv0 = camoUv0;
    mesh.name = g.name;
    mesh.userData.mat = g.mat;
    if (g.weapon) mesh.userData.weapon = g.weapon;
    if (g.skinned) {
      // Bone-driven cloth (camo nets, tarps): the file stores it in bind-pose bone space and
      // this app has no skinning path, so unhidden it renders as a stretched slab through the
      // vehicle. Its texture stays editable in 2D.
      mesh.userData.unposed = true;
    }
    if (isEffectMat(g.name, g.mat)) {
      mesh.userData.effect = true;
      mesh.renderOrder = 10; // additive blend composes over the airframe
    }
    modelGroup.add(mesh);
    App.meshes.set(g.name, mesh);
  }
  scene.add(modelGroup);
  // buildScene runs again whenever a texture arrives, and it makes fresh meshes — so whatever the
  // Moving parts sliders are set to has to be re-applied to them, or the vehicle snaps back to
  // gear-down the first time a texture finishes decoding.
  if (typeof applyPose === "function" && !poseIsNeutral()) applyPose();   // both live in a later <script>, hence the guard
  const box = new THREE.Box3().setFromObject(modelGroup);
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  // Only reframe when the geometry itself changed. buildScene() also runs whenever a texture
  // arrives (rebuildAll) — snapping the camera back to default then would throw away the view
  // the user had lined up.
  if (App._framedGeom !== App.geomData) {
    App._framedGeom = App.geomData;
    cam.target.copy(c);
    cam.dist = Math.max(s.x, s.y, s.z) * 1.2;
    camera.near = cam.dist / 100; camera.far = cam.dist * 20; camera.updateProjectionMatrix();
  }
  App.modelSize = { x: s.x || 1, y: s.y || 1, z: s.z || 1 };
  // The bounding box's middle. `mirrorCenters` is NOT this — it is measured per axis from mirrored
  // part pairs and only means something on the mirror axis — so anything that wants "the middle of
  // the model" wants this one (showSymPlane does).
  App.modelCenter = { x: c.x, y: c.y, z: c.z };
  findSymmetry(c, s);
  // The mesh list is new, so the pylon/pod set has to be worked out again; applySceneVisibility
  // then settles every visibility rule in one pass (it also calls updateSelectionVisuals).
  App.mountParts = null;
  for (const n of [...App.hiddenParts]) if (!App.meshes.has(n)) App.hiddenParts.delete(n);
  if (App.soloSet) { App.soloSet = new Set([...App.soloSet].filter(n => App.meshes.has(n))); if (!App.soloSet.size) App.solo = App.soloKey = App.soloSet = null; }
  refreshPartList();
  if (typeof refreshPosePanel === "function") refreshPosePanel();
  applySceneVisibility();
}
function flipUVs(uv){ const o = new Float32Array(uv.length); for (let i = 0; i < uv.length; i += 2) { o[i] = uv[i]; o[i+1] = 1 - uv[i+1]; } return o; }
// ---------- Jet flames and gun flashes: the game's own sheet, added the way the game adds it ----------
// Until 2026-09-25 every effect quad wore one made-up gradient, faded to black across the WHOLE
// texture. The quads only use a strip of their atlas — every jet flame measured (F-14A, F-16A,
// F/A-18A) is u 0–0.99, v 0.76–0.99 of `jet_flame_diamonds` — so the fade never reached a quad's
// edge: the plume cards ended on hard white borders and the diamond discs were opaque white plates.
//
// The shader is `aces_weapon_fire` on all of them, flames and muzzle flashes alike, and its sheets
// say how it blends, decoded from the install:
//   * `jet_flame_diamonds` (2048² BC7): flat ORANGE under alpha 0 everywhere except the rings, which
//     alpha masks in. Colour bled under zero alpha is what an artist does for an alpha-weighted
//     shader; drawn by colour alone the plume cards would be solid orange slabs.
//   * `jet_flame` (512² DXT5, the older sheet): black where the plume cards sit, glow where alpha is.
//   * `gunfire` (512×256 DXT5): flashes on black, and alpha 0 across the entire sheet.
// So: additive, weighted by alpha — and by nothing when a sheet carries no alpha at all, or no muzzle
// flash would ever show. The plume the game draws behind an afterburner is a volumetric effect, not
// these quads (ROADMAP 4.13), so with the stock sheet what shows here is the nozzle ring (measured on
// an F-16A: the plume cards and the five diamond discs map onto the sheet's alpha-0 part).
//
// A SKIN's sheet is shown since 2026-10-24 (ROADMAP 4.13, queue item 18). The desc's flame material
// gives the vehicle a texture-only slot for its sheet (`addTextureOnlySlots`), a loaded skin's
// `jet_flame_diamonds` lands in it, and that is what the community skins in the owner's UserSkins
// repaint — plume and diamonds into the stock sheet's alpha-0 part, 30–35 % of the flame strip under
// non-zero alpha. So when such a slot exists the flame draws THE SLOT: its colour sheet (`slot.tex`,
// the canvas the 2-D view paints into, opaque RGB) weighted by its coverage (`slot.texCov`, the
// sheet's alpha) in the blend — SrcAlpha, One. Nothing is read back and nothing is rebuilt per
// stroke: `compositeSlot` uploads the stroke's rectangle into the very texture this samples, so an
// edit shows the frame it lands, at any size. (The card asked for a readback of up to 4096² off the
// UI thread; binding the live textures needs no readback at all, which is cheaper than either.)
// The order differs from `sheet()` below by one step — the GPU decodes sRGB before the multiply,
// where `sheet()` multiplies the sRGB bytes — which is also the order the game's sampler works in.
// `sheet()` stays for a material with no slot (a store's flame, a sheet the index does not hold).
const EffectMat = {
  sheets: new Map(),          // stem → { src: WeakRef to the decoded record it was built from, tex }
  grad: null,                 // the stand-in, for a model the game's desc does not describe (an .obj)

  // material → sheet, from the desc (its t0). Called by rebindMaterials BEFORE gcDecoded, which keeps
  // these stems: a flame has no slot, so nothing else would.
  bindSheets(bind){
    App.matEffect.clear();
    if (!bind) return;
    for (const g of App.geomData) {
      if (!isEffectMat(g.name, g.mat) || App.matEffect.has(g.mat)) continue;
      const dref = bind.map.get(g.mat.toLowerCase()) || (matBaseName(g.mat) === g.mat && descIndexRef(bind, g.mat));
      if (dref && dref.c) App.matEffect.set(g.mat, dref.c.toLowerCase());
    }
  },
  // Colour adds one-to-one (alpha is already folded into the sheet) and ALPHA IS LEFT ALONE. The
  // viewport's canvas has no alpha, so on screen this is plain additive; but Shot renders into a
  // transparent target and reads it as straight alpha, where AdditiveBlending also adds the quad's
  // alpha — every card, black where it draws nothing, would land in the PNG as an opaque slab.
  make(matName){
    const slot = this.slotOf(App.matEffect.get(matName));
    if (slot) {
      const m = new THREE.MeshBasicMaterial({ map: slot.tex, alphaMap: this.covered(slot) ? slot.texCov : null,
        transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
        blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
      m.userData.effect = true;
      return m;
    }
    const sheet = this.sheet(App.matEffect.get(matName));
    const m = sheet
      ? new THREE.MeshBasicMaterial({ map: sheet, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
          blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
          blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor })
      : new THREE.MeshBasicMaterial({ map: this.gradient(), blending: THREE.AdditiveBlending, transparent: true,
          opacity: .85, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    m.userData.effect = true;
    return m;
  },
  // The slot holding an effect sheet, once it has pixels. Matched on the stem the desc names, as
  // `addTextureOnlySlots` made it — the same lower-cased name App.matEffect holds.
  slotOf(stem){
    if (!stem) return null;
    for (const s of App.slots.values())
      if (s.cStem && s.cStem.toLowerCase() === stem && !s.missing && s.tex && s.composite) return s;
    return null;
  },
  // What a slot holding an effect sheet is, for its row in the slot list — or null when it holds none.
  kindOf(slot){
    const stem = slot && slot.cStem && slot.cStem.toLowerCase();
    if (!stem || ![...App.matEffect.values()].includes(stem)) return null;
    return /gunfire|muzzle/.test(stem) ? "gun flash" : /flame|afterburner/.test(stem) ? "jet flame" : "effect";
  },
  // Whether the slot's coverage weights it. `sheet()`'s rule, kept: a sheet with no alpha anywhere —
  // gunfire is alpha 0 across the whole sheet — is drawn by colour, or no muzzle flash would show.
  // A wear stack painted on it is coverage by definition. Asked once per imported mask.
  covered(slot){
    if (!slot.texCov) return false;
    if (chanHasLayers(slot, "wear")) return true;
    const cov = slot.covBase;
    if (!cov) return false;
    if (this._cov.has(cov)) return this._cov.get(cov);
    let any = false;
    for (let i = 0; i < cov.length; i++) if (cov[i]) { any = true; break; }
    this._cov.set(cov, any);
    return any;
  },
  _cov: new WeakMap(),
  // The sheet, premultiplied by its own alpha and box-filtered to at most 1024² (a preview: the
  // 2048² original would be 16 MB of GPU memory for a glow), so what `make` adds is exactly Σ rgb·a.
  // Alpha is set to 255 and not used. Rows are written bottom-up because a DataTexture is not
  // flipped on upload and the model's UVs were flipped for a flipped canvas.
  sheet(stem){
    const dec = stem && App.decoded.get(stem);
    if (!dec || !dec.mips || !dec.mips[0] || !dec.mips[0].rgba) return null;
    const had = this.sheets.get(stem);
    if (had && had.src.deref() === dec) return had.tex;
    if (had) had.tex.dispose();
    const { w, h, rgba } = dec.mips[0];
    let k = 1; while (w / k > 1024 || h / k > 1024) k *= 2;
    const W = Math.max(1, Math.floor(w / k)), H = Math.max(1, Math.floor(h / k));
    let hasAlpha = false;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) { hasAlpha = true; break; }
    const out = new Uint8Array(W * H * 4), n = k * k * 255;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = y * k; sy < y * k + k; sy++) for (let sx = x * k, i = (sy * w + sx) * 4; sx < x * k + k; sx++, i += 4) {
        const a = hasAlpha ? rgba[i + 3] : 255;
        r += rgba[i] * a; g += rgba[i + 1] * a; b += rgba[i + 2] * a;
      }
      const o = ((H - 1 - y) * W + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
    const tex = new THREE.DataTexture(out, W, H, THREE.RGBAFormat);
    tex.encoding = THREE.sRGBEncoding;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    this.sheets.set(stem, { src: new WeakRef(dec), tex });
    return tex;
  },
  // White-blue core → orange falloff along UV.v, faded to nothing across UV.u.
  gradient(){
    if (this.grad) return this.grad;
    const c = mkCanvas(64, 256), g = c.getContext("2d");
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, "#d8ecff"); grd.addColorStop(.14, "#8ab6ff"); grd.addColorStop(.42, "#ffd9a0");
    grd.addColorStop(.72, "#ff8a3d"); grd.addColorStop(1, "#1a0800");
    g.fillStyle = grd; g.fillRect(0, 0, 64, 256);
    const side = g.createLinearGradient(0, 0, 64, 0);
    side.addColorStop(0, "#000"); side.addColorStop(.5, "#fff"); side.addColorStop(1, "#000");
    g.globalCompositeOperation = "multiply";
    g.fillStyle = side; g.fillRect(0, 0, 64, 256);
    this.grad = new THREE.CanvasTexture(c);
    this.grad.encoding = THREE.sRGBEncoding;
    return this.grad;
  },
};
