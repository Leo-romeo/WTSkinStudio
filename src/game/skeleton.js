// Node maps are read once per model and kept: a preset can hang eight stores off one rack type.
const WeaponSkel = new Map();
async function modelSkeleton(model){
  if (WeaponSkel.has(model)) return WeaponSkel.get(model);
  let sk = null;
  try {
    const idx = await ensureGrpIndex();
    const ref = idx.skel.get(model + "_skeleton");
    if (ref) sk = loadSkeletonBytes(await readGrpResource(ref));
  } catch (e) { console.warn("skeleton " + model, e); }
  WeaponSkel.set(model, sk);
  return sk;
}
function vehicleSkeleton(){
  return (App.extracted && App.extracted.geo && App.extracted.geo.skeleton) || null;
}
// The loaded vehicle's baked clip, or null when it has none (an imported .obj, or a model the
// install ships no `_anim` for).
function vehicleAnim(){
  return (App.extracted && App.extracted.geo && App.extracted.geo.a2d) || null;
}
