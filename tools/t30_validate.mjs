// The export validator, run against every publishing rule in CLAUDE.md §1.
//
// validateExport() is deliberately pure — it takes a described export plan and returns findings —
// so the whole thing runs here with no browser, no App and no game install. Each rule gets both a
// plan that must PASS and a plan that must FAIL, because a check that never fires is worth nothing
// and a check that always fires is worse.
//
// The reference plan is a real one: an M1A2 SEP3 ground skin, set_tex + camo_skin_tex on the
// albedo plus the replace_tex camouflage pin, which is the shape every published ground skin in
// this install has.
//
// Usage: node tools/t30_validate.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "wt_skin_studio.html"), "utf8");
const a = src.indexOf("\n/*==VALIDATE==*/"), b = src.indexOf("\n/*==ENDVALIDATE==*/");
if (a < 0 || b < 0) throw new Error("no VALIDATE section in the page");
const { validateExport, validateWorst, WT_RULES } =
  new Function(src.slice(a + 1, b) + "\nreturn { validateExport, validateWorst, WT_RULES };")();

let checks = 0, fails = 0;
const ok = m => { checks++; console.log("  ok   " + m); };
const bad = m => { checks++; fails++; console.log("  FAIL " + m); };

// ---------------------------------------------------------------- the reference plan
const blkFor = (items, pins, mode) => {
  let s = 'name:t="user"\n\n';
  for (const p of pins) s += `replace_tex{\n  from:t="${p.stem}*"\n  to:t="${p.fileName}"\n}\n\n`;
  for (const it of items) {
    if (mode === "set_tex" && it.kind === "c")
      s += `set_tex{\n  from:t="${it.fromStem}*"\n  to:t="${it.fileName}"\n  param:t="camo_skin_tex"\n}\n\n`;
    else s += `replace_tex{\n  from:t="${it.fromStem}*"\n  to:t="${it.fileName}"\n}\n\n`;
  }
  return s;
};
// build a plan and regenerate its .blk unless the test is deliberately supplying a broken one
function plan(over = {}) {
  const p = {
    cls: "tank", mode: "set_tex", rank: 7,
    units: ["us_m1a2_sep3_abrams"],
    formats: { c: "bc3", n: "rgba8" },
    camoStems: ["us_camo_olive"],
    items: [
      { fileName: "m1a2_sep3_body.dds", fromStem: "m1a2_sep3_body_c", kind: "c", w: 4096, h: 4096, role: "exterior", bytes: 22 * 1048576 },
      { fileName: "m1a2_sep3_body_n.dds", fromStem: "m1a2_sep3_body_n", kind: "n", w: 2048, h: 2048, role: "exterior", bytes: 5 * 1048576 },
    ],
    pins: [{ stem: "us_camo_olive", fileName: "wtss_camo_us_camo_olive.dds", bytes: 262144 }],
    ...over,
  };
  if (!("blkText" in over)) p.blkText = blkFor(p.items, p.pins, p.mode);
  return p;
}
const find = (res, id) => res.find(r => r.id === id);
// assert one rule's level, and — for the passing baseline — that nothing else broke
const rule = (label, p, id, want, alsoClean) => {
  const res = validateExport(p);
  const r = find(res, id);
  if (!r) return bad(`${label}: rule "${id}" produced no finding`);
  if (r.level !== want) return bad(`${label}: ${id} is "${r.level}", expected "${want}" — ${r.title}`);
  if (alsoClean) {
    const other = res.filter(x => x.id !== id && (x.level === "error" || x.level === "warn"));
    if (other.length) return bad(`${label}: ${id} is ${want} but ${other.map(o => o.id + "=" + o.level).join(", ")} also fired`);
  }
  ok(`${label}: ${id} = ${want}${r.detail ? " — " + r.title : ""}`);
};

console.log("=== the reference plan is clean ===");
{
  const res = validateExport(plan());
  const noisy = res.filter(r => r.level === "error" || r.level === "warn");
  if (noisy.length) bad("a real M1A2 ground skin should raise nothing: " + noisy.map(r => `${r.id}=${r.level} (${r.title})`).join(", "));
  else ok(`a real M1A2 ground skin raises nothing (${res.length} rules checked, worst = ${validateWorst(res)})`);
  // every rule must actually report, or the panel silently omits it
  const ids = new Set(res.map(r => r.id));
  for (const id of ["size", "names", "blkcount", "blkrefs", "size-cap", "settex", "camopin", "protected", "format"])
    ids.has(id) ? ok(`rule "${id}" reports`) : bad(`rule "${id}" never reported`);
}

console.log("\n=== 1. texture dimensions ===");
rule("square", plan({ items: [{ fileName: "a.dds", fromStem: "a_c", kind: "c", w: 2048, h: 1024, role: "exterior", bytes: 100 }] }), "size", "error");
rule("power of two", plan({ items: [{ fileName: "a.dds", fromStem: "a_c", kind: "c", w: 1000, h: 1000, role: "exterior", bytes: 100 }] }), "size", "error");
rule("multiple of 8", plan({ items: [{ fileName: "a.dds", fromStem: "a_c", kind: "c", w: 4, h: 4, role: "exterior", bytes: 100 }] }), "size", "error");
rule("too large", plan({ items: [{ fileName: "a.dds", fromStem: "a_c", kind: "c", w: 16384, h: 16384, role: "exterior", bytes: 100 }] }), "size", "error");
rule("legal 512", plan({ items: [{ fileName: "a.dds", fromStem: "a_c", kind: "c", w: 512, h: 512, role: "exterior", bytes: 100 }] }), "size", "pass");
// 8192 is aircraft-only, and rank VI+ or a bomber at that
{
  const big = w => [{ fileName: "a.dds", fromStem: "a_c", kind: "c", w, h: w, role: "exterior", bytes: 100 }];
  rule("8192 on a tank", plan({ items: big(8192) }), "size8k", "error");
  rule("8192 on a rank VII aircraft", plan({ cls: "air", mode: "replace_tex", rank: 7, camoStems: [], pins: [], items: big(8192) }), "size8k", "pass");
  rule("8192 on a rank III aircraft", plan({ cls: "air", mode: "replace_tex", rank: 3, camoStems: [], pins: [], items: big(8192) }), "size8k", "warn");
  const res = validateExport(plan({ items: big(4096) }));
  find(res, "size8k") ? bad("size8k fired at 4096, where it does not apply") : ok("size8k is silent at 4096");
}

console.log("\n=== 2. file names ===");
rule("baseline ASCII", plan(), "names", "pass", true);
for (const nm of ["my skin.dds", "camo_ölig.dds", "body#1.dds", "body.dds.dds"])
  rule(`rejects "${nm}"`, plan({ items: [{ fileName: nm, fromStem: "a_c", kind: "c", w: 512, h: 512, role: "exterior", bytes: 100 }] }), "names", "error");
rule("accepts hyphen and underscore", plan({ items: [{ fileName: "us_m1a2-sep3_body.dds", fromStem: "a_c", kind: "c", w: 512, h: 512, role: "exterior", bytes: 100 }] }), "names", "pass");
// a bad UNIT name has to be caught too — it becomes a .blk file name
rule("catches a bad unit name", plan({ units: ["m1a2 sep3"] }), "names", "error");

console.log("\n=== 3. one .blk per archive ===");
rule("one unit", plan(), "blkcount", "pass");
rule("no unit at all", plan({ units: [] }), "blkcount", "error");
// several .blks are correct for UserSkins and wrong for a Live submission — a note, not a fault
rule("two units is informational", plan({ units: ["us_m1a2_sep3_abrams", "uk_m1a2_sep3_abrams"] }), "blkcount", "info");

console.log("\n=== 4. blk <-> archive symmetry, both directions ===");
rule("baseline symmetric", plan(), "blkrefs", "pass");
{
  // the .blk names a texture the archive does not carry
  const p = plan();
  p.blkText = p.blkText.replace("m1a2_sep3_body.dds", "m1a2_sep3_body_MISSING.dds");
  rule("blk names a texture not shipped", p, "blkrefs", "error");
}
{
  // the archive carries a texture the .blk never names
  const p = plan();
  p.items.push({ fileName: "orphan.dds", fromStem: "orphan_c", kind: "c", w: 512, h: 512, role: "exterior", bytes: 100 });
  rule("archive carries a texture the blk omits", p, "blkrefs", "error");
}

console.log("\n=== 5. archive size ceiling ===");
rule("ground under 40 MB", plan(), "size-cap", "pass");
rule("ground over 40 MB", plan({ items: [{ fileName: "a.dds", fromStem: "a_c", kind: "c", w: 4096, h: 4096, role: "exterior", bytes: 45 * 1048576 }] }), "size-cap", "error");
rule("ground at 36 MB warns", plan({ items: [{ fileName: "a.dds", fromStem: "a_c", kind: "c", w: 4096, h: 4096, role: "exterior", bytes: 36 * 1048576 }] }), "size-cap", "warn");
rule("aircraft cap is 70 MB", plan({ cls: "air", mode: "replace_tex", camoStems: [], pins: [],
  items: [{ fileName: "a.dds", fromStem: "a_c", kind: "c", w: 4096, h: 4096, role: "exterior", bytes: 45 * 1048576 }] }), "size-cap", "pass");
{
  const capAir = WT_RULES.capMB.air, capTank = WT_RULES.capMB.tank;
  capAir === 70 && capTank === 40 ? ok(`caps are ${capTank} MB ground / ${capAir} MB air`) : bad(`caps are ${capTank}/${capAir}, expected 40/70`);
}

console.log("\n=== 6. ground albedo must be set_tex + camo_skin_tex ===");
rule("baseline set_tex", plan(), "settex", "pass");
{
  // replace_tex on a ground albedo: installs, but kills in-game decals
  const p = plan({ mode: "replace_tex" });
  p.blkText = blkFor(p.items, p.pins, "replace_tex");
  rule("ground albedo via replace_tex", p, "settex", "error");
}
{
  // set_tex present but the param dropped — the single most consequential typo in a ground .blk
  const p = plan();
  p.blkText = p.blkText.replace(/\n  param:t="camo_skin_tex"/, "");
  rule("set_tex without param:t=camo_skin_tex", p, "settex", "error");
}
rule("aircraft on replace_tex", plan({ cls: "air", mode: "replace_tex", camoStems: [], pins: [] }), "settex", "pass");
rule("aircraft on set_tex", plan({ cls: "air", mode: "set_tex", camoStems: [], pins: [] }), "settex", "warn");
// a normal map is always replace_tex, even on a ground vehicle — it must not trip the rule
{
  const p = plan({ items: [{ fileName: "body_n.dds", fromStem: "body_n", kind: "n", w: 2048, h: 2048, role: "exterior", bytes: 100 }] });
  rule("normal-map-only ground export", p, "settex", "info");
}

console.log("\n=== camouflage pin, the other half of a ground skin ===");
rule("pinned", plan(), "camopin", "pass");
rule("unpinned with a camo present", plan({ pins: [], blkText: blkFor(plan().items, [], "set_tex") }), "camopin", "warn");

console.log("\n=== 7. cockpit and engine-flame textures ===");
rule("exterior only", plan(), "protected", "pass");
rule("a cockpit sheet", plan({ items: [{ fileName: "f_4e_cockpit.dds", fromStem: "f_4e_cockpit_c", kind: "c", w: 2048, h: 2048, role: "cockpit", bytes: 100 }] }), "protected", "error");
rule("an effect sheet", plan({ items: [{ fileName: "jet_flame.dds", fromStem: "jet_flame", kind: "c", w: 512, h: 512, role: "effect", bytes: 100 }] }), "protected", "error");

console.log("\n=== 8. storage format ===");
rule("BC3 albedo", plan(), "format", "pass");
rule("RGBA8 albedo", plan({ formats: { c: "rgba8", n: "rgba8" } }), "format", "info");
rule("TGA", plan({ formats: { c: "tga", n: "tga" } }), "format", "info");

console.log("\n=== validateWorst ===");
{
  const cases = [
    ["clean", plan(), "pass"],
    ["warn only", plan({ cls: "air", mode: "set_tex", camoStems: [], pins: [] }), "warn"],
    ["error present", plan({ units: [] }), "error"],
  ];
  for (const [label, p, want] of cases) {
    const got = validateWorst(validateExport(p));
    got === want ? ok(`worst of ${label} = ${want}`) : bad(`worst of ${label} = ${got}, expected ${want}`);
  }
}

console.log("\n=== every finding is renderable ===");
{
  // the panel does textContent on all four fields, so any undefined would print "undefined"
  let broken = 0;
  for (const p of [plan(), plan({ units: [] }), plan({ cls: "air", mode: "set_tex", camoStems: [], pins: [] }),
    plan({ items: [] }), plan({ items: [], pins: [], camoStems: [] })])
    for (const r of validateExport(p))
      if (!r.id || !r.level || typeof r.title !== "string" || typeof r.detail !== "string" ||
        !["error", "warn", "pass", "info"].includes(r.level)) { console.log("      bad finding: " + JSON.stringify(r)); broken++; }
  broken ? bad(`${broken} finding(s) have a missing or malformed field`) : ok("every finding has id, level, string title and string detail");
}
// an empty export must not throw — the panel calls this on every slot-list refresh
{
  try {
    const res = validateExport({ cls: "other", mode: "replace_tex", units: [], items: [], pins: [], blkText: "", formats: {} });
    ok(`an empty plan returns ${res.length} findings without throwing`);
  } catch (e) { bad("an empty plan threw: " + e.message); }
}

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
