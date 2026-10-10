// OBJ / MTL text for export + self-contained project embedding
function buildOBJText(geo, bind, mtlName){
  const L = ["# Extracted from War Thunder game files by WT Skin Studio", "mtllib " + mtlName];
  for (const v of geo.verts) L.push("v " + v[0].toFixed(4) + " " + v[1].toFixed(4) + " " + v[2].toFixed(4));
  for (const t of geo.uvs) L.push("vt " + t[0].toFixed(4) + " " + t[1].toFixed(4));
  // The camouflage's own UV (tc1, ROADMAP 4.50 (6)) has no place in OBJ, which carries one texture
  // coordinate per corner. It rides along as a comment every other reader skips, one line per `vt`
  // and indexed like it, so a project file keeps it — the embedded .obj is the only model a .wtproj
  // has. `-` marks a vertex whose format has none.
  if (geo.cuvs) for (let i = 0; i < geo.uvs.length; i++) {
    const t = geo.cuvs[i];
    L.push(t ? "#vt1 " + t[0].toFixed(4) + " " + t[1].toFixed(4) : "#vt1 -");   // 1/4096 steps: 4 places hold them
  }
  for (const obj of geo.objects) {
    L.push("g " + obj.name);
    let last = null;
    for (const g of obj.groups) {
      const nm = matNameForIndex(bind, g.matIndex);
      if (nm !== last) { L.push("usemtl " + nm); last = nm; }
      for (const f of g.faces) { const a = f[0]+1, b = f[1]+1, c = f[2]+1; L.push("f " + a + "/" + a + " " + b + "/" + b + " " + c + "/" + c); }
    }
  }
  return L.join("\n");
}
function buildMTLText(geo, bind){
  const seen = new Set(), L = [], used = [];
  for (const obj of geo.objects) for (const g of obj.groups) {
    const nm = matNameForIndex(bind, g.matIndex);
    if (seen.has(nm)) continue; seen.add(nm);
    const entry = bind ? (bind.map.get(nm.toLowerCase()) || bind.map.get("#" + g.matIndex)) : null;
    L.push("newmtl " + nm, "Ka 1.000 1.000 1.000", "Kd 1.000 1.000 1.000", "illum 2");
    if (entry && entry.c) { L.push("map_Kd " + entry.c + ".dds"); used.push(entry.c); }
    if (entry && entry.n) { L.push("map_bump " + entry.n + ".dds"); used.push(entry.n); }
    L.push("");
  }
  return { mtl: L.join("\n"), textures: [...new Set(used)] };
}
