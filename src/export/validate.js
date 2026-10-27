/*==VALIDATE==*/
// ---------- The published-skin rules, in one place ----------
// Every rule the CDK states about a user skin is checked here and nowhere else, so the pre-export
// panel, the export-time confirmation and the offline test (tools/t30_validate.mjs) all read the
// same verdict. Deliberately PURE — it takes a described plan and returns findings; it touches no
// DOM and no App state, which is the only reason it can be lifted and run under Node.
//
// Levels: "error" the game or the Live market will reject it · "warn" it will install but
// something is probably not what the author intended · "pass" checked and fine · "info" a note.
const WT_RULES = {
  sides: [128, 256, 512, 1024, 2048, 4096, 8192],
  bigSide: 8192,                 // rank VI+ aircraft and bombers only
  capMB: { tank: 40, ship: 40, air: 70, heli: 70, other: 70 },
  // The CDK says "letters and digits". Every published skin in this install also uses underscores
  // and hyphens, and the extension needs a dot, so those three are allowed and anything else —
  // spaces, accents, anything non-ASCII — is an error, since the game matches names byte for byte.
  nameOk: /^[A-Za-z0-9_\-]+\.[A-Za-z0-9]+$/,
};
// One entry per published-skin rule, in the order they are checked. Kept as a list rather than as
// one long function so each rule is separately readable — and so a rule that stops reporting is
// visible as a missing entry rather than as a branch that quietly never fires.
const WT_RULE_CHECKS = [
function ruleSizes({ add, items, cls, plan }){
  const isPow2 = v => v >= 8 && (v & (v - 1)) === 0;
  const badSize = [], bigOnes = [];
  for (const it of items) {
    if (it.w !== it.h) badSize.push(`${it.fileName} is ${it.w}×${it.h} — must be square`);
    else if (!isPow2(it.w)) badSize.push(`${it.fileName} is ${it.w}px — must be a power of two`);
    else if (it.w % 8) badSize.push(`${it.fileName} is ${it.w}px — must be a multiple of 8`);
    else if (!WT_RULES.sides.includes(it.w)) badSize.push(`${it.fileName} is ${it.w}px — outside 128…8192`);
    else if (it.w === WT_RULES.bigSide) bigOnes.push(it.fileName);
  }
  if (badSize.length) add("error", "size", `${badSize.length} texture${badSize.length > 1 ? "s are" : " is"} not a legal size`, badSize.join(" · "));
  else add("pass", "size", "Every texture is square, power-of-two and 128…8192", items.length ? items.map(i => `${i.fileName} ${i.w}²`).join(" · ") : "nothing to check");
  // 8192 is reserved for rank VI+ aircraft and bombers. Rank is known from the unit registry;
  // "bomber" is not a flag the game files expose here, so a low-rank aircraft is a warning the
  // author can overrule rather than an error.
  if (bigOnes.length) {
    if (cls !== "air") add("error", "size8k", "8192px is aircraft-only", `${bigOnes.join(", ")} — ${cls === "tank" ? "ground" : cls} vehicles cap at 4096px.`);
    else if ((plan.rank || 0) >= 6) add("pass", "size8k", "8192px allowed at this rank", `Rank ${plan.rank} aircraft. ${bigOnes.join(", ")}`);
    else add("warn", "size8k", "8192px needs rank VI+ or a bomber", `${bigOnes.join(", ")} — this unit reads as rank ${plan.rank || "?"}. Fine if it is a bomber; otherwise drop to 4096.`);
  }
},

function ruleNames({ add, items, pins, units }){
  const allFiles = [...items.map(i => i.fileName), ...pins.map(p => p.fileName), ...units.map(u => u + ".blk")];
  const badName = allFiles.filter(n => !WT_RULES.nameOk.test(n));
  if (badName.length) add("error", "names", `${badName.length} file name${badName.length > 1 ? "s use" : " uses"} characters the game will not match`,
    badName.join(" · ") + " — ASCII letters, digits, underscore and hyphen only.");
  else add("pass", "names", "Every file name is plain ASCII", `${allFiles.length} file${allFiles.length === 1 ? "" : "s"}`);
},

function ruleBlkCount({ add, units }){
  // A UserSkins FOLDER may hold one .blk per unit and that is how real skins install onto every
  // vehicle sharing a model. A WT Live submission ARCHIVE must contain exactly one. Both are true,
  // so this is a note about publishing rather than a fault.
  if (units.length === 0) add("error", "blkcount", "No .blk would be written", "Without one the game never sees the skin.");
  else if (units.length === 1) add("pass", "blkcount", "Exactly one .blk", units[0] + ".blk");
  else add("info", "blkcount", `${units.length} .blk files, one per vehicle`, units.join(", ") +
    " — correct for UserSkins. To submit to the WT Live market, upload one archive per vehicle with only that vehicle's .blk in it.");
},

// The .blk and the archive must describe each other, in BOTH directions: a texture named but not
// shipped, and a texture shipped but not named, are both rejections.
function ruleBlkRefs({ add, items, pins, plan }){
  const refd = new Set();
  const blkText = plan.blkText || "";
  for (const m of blkText.matchAll(/\bto:t\s*=\s*"([^"]*)"/g)) refd.add(m[1]);
  const shipped = new Set([...items.map(i => i.fileName), ...pins.map(p => p.fileName)]);
  const missing = [...refd].filter(n => !shipped.has(n));
  const stray = [...shipped].filter(n => !refd.has(n));
  if (missing.length) add("error", "blkrefs", `The .blk names ${missing.length} texture${missing.length > 1 ? "s" : ""} the archive does not contain`, missing.join(" · "));
  else if (stray.length) add("error", "blkrefs", `${stray.length} texture${stray.length > 1 ? "s are" : " is"} in the archive but not named in the .blk`, stray.join(" · "));
  else add("pass", "blkrefs", "The .blk and the archive reference each other exactly", `${refd.size} texture${refd.size === 1 ? "" : "s"} both ways`);
},

function ruleArchiveSize({ add, items, pins, cls, plan }){
  const cap = WT_RULES.capMB[cls] || 70;
  const bytes = [...items, ...pins].reduce((n, f) => n + (f.bytes || 0), 0);
  const mb = bytes / 1048576;
  const approx = plan.estimated ? "≈" : "";
  if (!bytes) add("info", "size-cap", "Archive size not measured yet", `Limit is ${cap} MB for this vehicle class.`);
  else if (mb > cap) add("error", "size-cap", `Archive is ${approx}${mb.toFixed(1)} MB — over the ${cap} MB limit`,
    "Drop a texture's resolution or use the WT Live preset. Largest: " +
    [...items, ...pins].slice().sort((a, b) => (b.bytes || 0) - (a.bytes || 0)).slice(0, 3).map(f => `${f.fileName} ${((f.bytes || 0) / 1048576).toFixed(1)} MB`).join(", "));
  else if (mb > cap * 0.85) add("warn", "size-cap", `Archive is ${approx}${mb.toFixed(1)} MB of the ${cap} MB limit`, "Close to the ceiling — check before adding another texture.");
  else add("pass", "size-cap", `Archive is ${approx}${mb.toFixed(1)} MB, limit ${cap} MB`, "");
},

// Without param:t="camo_skin_tex" in-game decals stop working and Market acceptance drops. The
// camouflage pin is the other half of the same rule: skip it and the shader tints the paint.
function ruleGroundPaint({ add, items, pins, cls, plan }){
  const ground = cls === "tank" || cls === "ship";
  const blkText = plan.blkText || "";
  if (ground) {
    // A camouflage tile of your own is not an albedo: its pins name it through replace_tex, which is
    // the CDK's own form for a scalable camouflage (ROADMAP 4.50 (6)).
    const diffuse = items.filter(i => i.kind === "c" && !i.camoTile);
    const setTexBlocks = [...blkText.matchAll(/set_tex\s*{([^}]*)}/g)].map(m => m[1]);
    const withParam = new Set();
    for (const b of setTexBlocks) {
      if (!/param:t\s*=\s*"camo_skin_tex"/.test(b)) continue;
      const to = /\bto:t\s*=\s*"([^"]*)"/.exec(b);
      if (to) withParam.add(to[1]);
    }
    const notSet = diffuse.filter(i => !withParam.has(i.fileName));
    if (!diffuse.length) add("info", "settex", "No albedo in this export", "Nothing for the camo_skin_tex rule to apply to.");
    else if (notSet.length) add("error", "settex", `${notSet.length} ground albedo texture${notSet.length > 1 ? "s do" : " does"} not use set_tex + camo_skin_tex`,
      notSet.map(i => i.fileName).join(" · ") + " — with replace_tex instead, in-game decals stop working and you take over the wear mask yourself.");
    else add("pass", "settex", "Every ground albedo uses set_tex + camo_skin_tex", diffuse.map(i => i.fileName).join(" · "));
    // the other half of a ground skin: pin the scalable camouflage, or the shader tints the paint
    if (plan.camoStems && plan.camoStems.length && !pins.length)
      add("warn", "camopin", "The scalable camouflage is not pinned", "The player's selected camouflage (" +
        plan.camoStems.slice(0, 3).join(", ") + ") will tint everything your alpha does not cover, so the skin looks different for every player.");
    else if (pins.length) add("pass", "camopin", `Camouflage pinned for ${pins.length} sheet${pins.length === 1 ? "" : "s"}`, pins.map(p => p.stem).join(" · "));
    // Not a rule the game enforces, so info and not a warning — but a grid published by accident is
    // the one way the scale check can reach a player (ROADMAP 3.45).
    if (items.some(i => i.calGrid)) add("info", "calgrid", "Your camouflage tile is the calibration grid",
      "It is a scale check, not a pattern. Scale check ▸ Remove grid puts back the base it covered.");
  } else if (plan.mode === "set_tex") {
    add("warn", "settex", "Aircraft cannot use set_tex", "Aircraft have no scalable camouflage — their albedo IS the paint, so replace_tex is the only mode that works.");
  } else add("pass", "settex", "replace_tex is correct for this vehicle", cls === "air" || cls === "heli" ? "Aircraft have no scalable camouflage." : "");
},

// Which sheet is a cockpit is decided by slotRole() from the geometry, not from the file name.
function ruleProtected({ add, items }){
  const protectedTex = items.filter(i => i.role === "cockpit" || i.role === "effect");
  if (protectedTex.length) add("error", "protected", `${protectedTex.length} texture${protectedTex.length > 1 ? "s are" : " is"} a cockpit or engine-flame sheet`,
    protectedTex.map(i => `${i.fileName} (${i.role === "cockpit" ? "cockpit/interior" : "engine flame or effect"})`).join(" · ") +
    " — the CDK forbids modifying these, so WT Live refuses the skin. Remove the edits or untick the texture before publishing." +
    // ROADMAP 4.13 (owner, 2026-10-22): the game itself does show a UserSkin's own flame sheet —
    // 15 community skins in his UserSkins carry `jet_flame_diamonds` with this same replace_tex.
    (protectedTex.some(i => i.role === "effect") ? " A skin you keep in UserSkins works: the game shows its own flame sheet." : ""));
  else add("pass", "protected", "No cockpit or engine-flame texture is modified", "");
},

// The jet-flame sheet goes out as DXT5 (owner, 2026-10-24, ROADMAP 4.13a). The export forces it
// (`ExportCollect.fmtOf`); this is what says so if anything else would ever go out.
function ruleFlameFormat({ add, items }){
  const flame = items.filter(i => i.role === "effect" && i.kind === "c");
  if (!flame.length) return;
  const bad = flame.filter(i => i.fmt && i.fmt !== "bc3");
  if (bad.length) add("error", "flamefmt", "A jet-flame sheet is not DXT5",
    bad.map(i => i.fileName + " (" + i.fmt + ")").join(" · ") + " — the game takes a skin's own flame sheet as DXT5 (BC3).");
  else add("pass", "flamefmt", "The jet-flame sheet is DXT5", flame.map(i => i.fileName).join(" · "));
},

function ruleFormat({ add, plan }){
  const fmts = plan.formats || {};
  if (fmts.c === "tga" || fmts.n === "tga") add("info", "format", "Exporting TGA", "TGA is for editing elsewhere. Ship DDS BC3 (“DDS rgba 8 bpp interpolated alpha”) — it is what the CDK recommends and it is a quarter of the size.");
  else if (fmts.c === "bc3") add("pass", "format", "Albedo is BC3/DXT5, the recommended format", "");
  else add("info", "format", "Albedo is uncompressed RGBA8", "Larger than the recommended BC3, but the right choice when hard-edged markings matter — BC3 cannot hold a three-hue block.");
},

// Level content (ROADMAP 4.58): silent unless a texture has some. A TGA holds one level, so one set
// to TGA by hand would ship without the levels made for it (the preset's TGA falls back to DDS on
// its own, `ExportCollect.formatFor`); and a Market or trophy skin has its levels regenerated by Gaijin's
// tool (docs/MIP_LEVELS.md §2), so the author hears that level effects are a UserSkin feature.
function ruleLevels({ add, items }){
  const own = items.filter(i => i.levels);
  if (!own.length) return;
  const tga = own.filter(i => i.fmt === "tga");
  if (tga.length) add("error", "levels-tga", `${tga.map(i => i.fileName).join(", ")} ${tga.length > 1 ? "carry their" : "carries its"} own mip levels and ${tga.length > 1 ? "are" : "is"} set to TGA`,
    "A TGA holds one level, so the levels made for it would be lost. Set it to Preset, BC3 or RGBA8 in Textures out.");
  add("info", "levels", "Own mip levels: " + own.map(i => i.fileName + " (" + i.levels + ")").join(" · "),
    "Written with the whole chain whatever the Mipmaps tick says. A UserSkin feature: Gaijin's tool regenerates the levels of a Market or trophy skin, so a WT Live upload loses them.");
},
];
function validateExport(plan){
  const R = [];
  const ctx = {
    plan,
    add: (level, id, title, detail) => R.push({ id, level, title, detail }),
    items: plan.items || [], pins: plan.pins || [], units: plan.units || [],
    cls: plan.cls || "other",
  };
  for (const check of WT_RULE_CHECKS) check(ctx);
  return R;
}
const validateWorst = res => res.some(r => r.level === "error") ? "error" : res.some(r => r.level === "warn") ? "warn" : "pass";
/*==ENDVALIDATE==*/
