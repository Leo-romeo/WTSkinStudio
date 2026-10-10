// Which texels of this slot's sheet any of its parts actually covers — what the exporter pads the
// seams out of. One byte per texel, and the value is **1** because `padSeams` tests `filled[i] === 1`
// (it writes 2 for a texel it has just filled and then settles it back to 1).
//
// No canvas is involved any more (ROADMAP 4.23(b)). It used to fill a path, then read the whole
// sheet back with `getImageData` and convert the alpha to 1/0 — at an 8192² export that is a 268 MB
// canvas and a full-surface readback, to produce the byte array `rasterUVTriangles` now writes
// directly. That also means this function is pure and DOM-free apart from the flip checkbox, which
// is the thing that used to keep it off the worker (see export/pipeline.js).
function getUVMask(slot, w, h){
  slot._uvMasks = slot._uvMasks || {};
  const key = w + "x" + h;
  if (slot._uvMasks[key] !== undefined) return slot._uvMasks[key];
  if (!App.geomData) return (slot._uvMasks[key] = null);
  const flipV = $("optFlipV").checked;
  const mask = new Uint8Array(w * h);
  let any = false;
  for (const gd of App.geomData) {
    if (App.matSlot.get(gd.mat) !== slot.id) continue;
    any = true;
    rasterUVTriangles(mask, gd.uv, w, h, flipV, 1);
  }
  return (slot._uvMasks[key] = any ? mask : null);
}
