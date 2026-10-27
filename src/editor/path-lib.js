"use strict";
// ---------- Path presets (ROADMAP 4.52 (4)) ----------
// "Save a whole path as a preset, in a library like the decal library: the path, whether it is
// filled or stamped, and the brush it was stamped with." A preset is what a path layer is made of —
// its recipe, `PathLayer.save`'s record — or, saved from a path that is not a layer yet, the path
// alone. Kept in this browser beside the decal library, in the same IndexedDB store under keys of
// its own: `pathIndex`, the list (id, name, what it is, when), and `path:<id>`, one record each. An
// index row knows nothing about decals and the decal index nothing about paths, so neither library
// can list the other's entries as its own.
//
// Writes go one at a time, as the tip library's do (`Tips.write`): two saves in flight would each
// read the index, add their row and write it back, and the second would drop the first's.
const PathLib = {
  KEY: "pathIndex", PREFIX: "path:", CAP: 200,
  _q: Promise.resolve(),
  write(fn){
    const run = PathLib._q.then(fn);
    PathLib._q = run.then(() => null, e => e);           // the caller hears a failure through `run`; the queue only waits for it
    return run;
  },
  async index(){
    const v = await idbGet(PathLib.KEY);
    return Array.isArray(v) ? v.filter(r => r && typeof r.id === "string" && typeof r.name === "string") : [];
  },
  // `shape` is a path layer's recipe, or null to keep the path alone.
  add(name, path, shape){
    return PathLib.write(async () => {
      const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      // The sheet it was drawn on rides beside the path, so Use can lay it at another sheet's scale.
      const sheet = Array.isArray(path.sheet) ? path.sheet.slice(0, 2) : null;
      const rec = shape ? { shape: PathLayer.save(shape), sheet } : { path: Path.clone(path), sheet };
      await idbSet(PathLib.PREFIX + id, rec);
      const idx = await PathLib.index();
      idx.unshift({ id, name: String(name || "Path").slice(0, 60), verb: shape ? shape.verb : null, at: Date.now() });
      await idbSet(PathLib.KEY, idx.slice(0, PathLib.CAP));
      return id;
    });
  },
  // Read back as data, through the same reader a project file's recipe goes through: `{ shape }` for
  // a layer's recipe, `{ path }` for a path alone, null for a record that is neither.
  async get(id){
    const rec = await idbGet(PathLib.PREFIX + id);
    if (!rec || typeof rec !== "object") return null;
    const sheet = Array.isArray(rec.sheet) && rec.sheet.every(v => typeof v === "number" && v > 0 && v <= 65536) ? rec.sheet.slice(0, 2) : null;
    if (rec.shape) { const shape = PathLayer.load(rec.shape); return shape ? { shape, sheet } : null; }
    const sh = PathLayer.load({ path: rec.path, verb: "fill" });
    return sh ? { path: sh.path, sheet } : null;
  },
  remove(id){
    return PathLib.write(async () => {
      await idbDel(PathLib.PREFIX + id);
      await idbSet(PathLib.KEY, (await PathLib.index()).filter(r => r.id !== id));
    });
  },
};
