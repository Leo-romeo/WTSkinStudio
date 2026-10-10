const App = {
  decoded: new Map(),      // stem -> {width,height,mips,fileName}
  // A vehicle's texture load is a transaction, and this is its token. Anything that lands after the
  // user cancelled the load, or after clearVehicleState() emptied `decoded` for a different
  // vehicle, must be DISCARDED rather than applied — otherwise decodes still in flight repopulate
  // what was just cleared, and "clear" appears to clear only what had arrived by then. ROADMAP 1.2
  // widened that window rather than opening it: a chunk now decodes at pool width.
  texGen: 0,
  slots: new Map(),        // stem -> slot
  matSlot: new Map(),      // material name -> slot stem
  geomData: null, meshes: new Map(),
  // 3-D view cursor state: whether the pointer is over a projected decal it could grab, and
  // whether one is being dragged right now. Only refreshViewCursor() reads them.
  projHover: false, projDragging: false,
  // The active layer is the NODE itself, not an index — see activeLayerObj (ROADMAP 4.9).
  activeSlot: null, activeLayer: null,
  // Three axes, not one enum: which gesture, which channel it lands on, and whether it goes into
  // the layer or into its mask (ROADMAP 4.28(d)). `mode` is still here — as an accessor over these
  // three, installed by `editor/tools.js`, which is also where the nine legacy names live.
  brush: { tool: "brush", chan: "color", target: "content",
           color: "#8a9a5b", size: 48, opacity: 1, hardness: .7, value: 128,
           heal: false,                                      // the Clone's tone matching (4.44)
           // ROADMAP 4.50 (4) + 6.4 (editor/pen.js). Flow and Build up are what each dab lays down
           // and whether Opacity caps the stroke; pSize / pFlow are what a pen's pressure drives —
           // all four per tool. `lazy` (the Smoothing string, screen px) and `curve` (the pressure
           // gamma) are the hand's, one across every tool.
           flow: 1, build: false, pSize: true, pFlow: false, lazy: 0, curve: 1,
           // ROADMAP 4.50 (10) (editor/tips.js, Pen.dab): the tip each dab is laid in, and how a dab
           // varies — size, flow and angle jitter and scatter as fractions, the angle in degrees,
           // and whether it turns to face the stroke. All per tool; all 0 is the brush as it was.
           tip: "round", sizeJit: 0, flowJit: 0, scatter: 0, angle: 0, angleJit: 0, follow: false },
  // What every OTHER tool was left set to (ROADMAP 3.22). `brush` above is whichever one is in
  // hand; this is where the rest of them wait, so a 4-texel panel line and a 200-texel wear brush
  // can both exist. Filled lazily — a tool that has never been picked up has no row here.
  brushTools: {},
  paint3d: false, objName: null,
  undoStack: [], selParts: new Set(), protectedParts: new Set(),
  userSkins: [], skinDecoded: new Set(), skinApplied: null,
  // ROADMAP 3.31: publishability gates the user has opened THIS session (`ui/gate.js`). Never
  // persisted — an unlock that survives a reload is exactly the forgotten one the item describes.
  gateOpen: new Set(),
  matPaint: new Map(),     // material name -> stock paint (camo) texture stem
  // material name -> { cls, coat } for a material the desc says is GLASS. Its name cannot always
  // say so — the two canopy materials on an ef_2000_aesa have none — and the viewport had only the
  // name to go on, which is ROADMAP 4.15. `coat` is the t3 coating lookup the shader class carries
  // instead of an albedo: rainbow_coating, golden_coating, black_coating and four others.
  matGlass: new Map(),
  // material name -> the effect sheet it draws (its t0), for a jet flame or gun flash. The viewport
  // draws the game's own sheet on those quads (`EffectMat`); it is not a slot, so without this the
  // desc's answer was never asked for.
  matEffect: new Map(),
  paintColor: new Map(),   // paint stem -> average [r,g,b]
  // The camo (t1) sheets themselves, kept rather than averaged away. They are tiny — 32² to 512² —
  // and both the export and the preview need the real pixels: the export ships a copy so the
  // player's chosen camouflage cannot recolour the skin, and the preview samples it so what is on
  // screen is the same blend the game does. See camoPins() and makeMaterial().
  paintTex: new Map(),     // paint stem -> {width, height, rgba}
  skinCamo: new Map(),     // paint stem -> {fileName, data} carried in from a loaded skin's replace_tex
  paintTint: true, paintStrength: 1, coverageOn: true, showUnposed: false, showEffects: false, trackTiling: 1,
  hiddenParts: new Set(),  // parts the user switched off by hand in the Parts tree
  soloSet: null,
  chanView: "shaded", chanOn: { color: true, smooth: true, metal: true, normal: true },
  weaponsLoaded: new Map(),   // "<model> #<n>" -> {model, kind, path, parts, placed}
  extraBinds: new Map(),      // model name -> its own material->texture map
  // Both on: a vehicle arrives showing the pylons and racks that are part of its own model, and
  // anything hung on it afterwards is visible the moment it lands. Nothing is loaded onto the
  // stations though — the vehicle starts on the clean loadout, no ordnance and no drop tanks —
  // so "show" here means "don't hide what is there", not "fit something".
  showWeapons: false, showPylons: false, weaponPreset: null, standaloneWeapon: null,
  weaponLoadout: null,        // {arm, name, stations[]} — what the loaded loadout actually is
  weaponShowNodes: null, weaponHideNodes: null,   // the vehicle's own pylon nodes, per loadout
  manualBind: new Set(),   // material names the user bound by hand — never auto-rebound
  // Which BODY of the loaded vehicle is on screen (ROADMAP 4.14): the exterior, or the separate
  // high-definition cockpit model the game switches to in first person. One vehicle, one .blk,
  // one set of slots; `bodies` holds the per-body state the other one keeps while it is off screen
  // — see `Cockpit.FIELDS` for exactly what a body owns.
  body: "exterior", bodies: {},
};

function texStemOf(fileName){ return fileName.replace(/\.(dds|tga)$/i, "").toLowerCase(); }

// ---------- Effects (jet flames, gunfire) ----------
// `afterburner` added 2026-09-02, from the sweep in ROADMAP 4.13: the four authored flame sheets are
// `jet_flame_diamonds`, `jet_flame`, `afterburnerflamenozzlemask` and `afterburneratlastex`, and the
// last of those matches nothing else here. Deliberately NOT widened to `exhaust` or `trail`, which
// the same sweep measured: `exhaust` matches 131 stems and most of them are a vehicle's own exterior
// sheet or a cockpit gauge (`ju_87d_3_italy_exhaust_c`, `fr_gauge_exhaust_gas_temperature_800_c`), so
// it would cry wolf on ordinary skins — which is the failure the "nothing classified" branch of
// `slotRole` exists to avoid.
const EFFECT_RE = /gunfire|jet_flame|flame|muzzle|smoke|afterburner/;
function isEffectMat(meshName, matName){ return EFFECT_RE.test(((meshName || "") + " " + matBaseName(matName || "")).toLowerCase()); }
// ---------- Material names are only unique inside one model ----------
// A DynModel names its materials for itself, and the names repeat across models: two stores can
// both call a material "unknown_1" (what an unnamed material becomes), or both name it after the
// shader class. App.matSlot and the merged GameResDesc lookup are global, so those collisions
// handed a bomb the aircraft's texture — or another bomb's. A weapon's materials therefore carry
// their model in front of them; matBaseName() gets the plain name back for the places that read
// the NAME rather than use it as a key (effect detection, group rules, the label in the list).
const MAT_QUAL = "::";
function matQualify(model, mat){ return model + MAT_QUAL + mat; }
function matBaseName(m){ const i = String(m).indexOf(MAT_QUAL); return i < 0 ? String(m) : String(m).slice(i + MAT_QUAL.length); }
function matModelOf(m){ const i = String(m).indexOf(MAT_QUAL); return i < 0 ? null : String(m).slice(0, i); }

