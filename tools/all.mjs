// One command for the offline test suite. Each test still runs standalone exactly as before; this
// only sequences them, gives each the heap it needs, and turns the whole thing into a single exit
// code so it can gate a commit.
//
//   node tools/all.mjs            the install-free subset — no War Thunder needed  (npm test)
//   node tools/all.mjs --all      everything, including the roster sweeps          (npm run test:all)
//   node tools/all.mjs --verbose  stream each test's full output instead of its tail
//   node tools/all.mjs --list     show what would run, where the install is, and why anything does not run
//   node tools/all.mjs --only groups,compose      just those ids, by the names --list prints
//                                                 (--only=groups,compose is the same; any other
//                                                 option is refused)
//
// `--only` exists for the inner loop and not for the gate: the full run is 95 s (measured
// 2026-09-03), which is the right price to pay once before calling a change done and the wrong
// price to pay after every edit to one panel. It refuses an id it does not know rather than
// silently running a smaller suite than you asked for — a filter that quietly matches nothing is
// how a green run stops meaning anything. §5 still means the whole suite.
//
// The install is found by tools/wtdir.mjs — WT_DIR, else Steam's own library list, else the usual
// folders — and printed with how it was found; every install test is handed that one path. A run
// that cannot do what it was asked FAILS before anything starts, in one line: a WT_DIR that is set
// but is not an install, in every mode (a misconfiguration); and no install at all, for --all or an
// install id under --only. An install test that prints SKIP is a failure too, and so is any test
// that skipped because no Chrome or Edge was found (tools/verdict.mjs). Until 2026-10-10 a
// missing install was a SKIP line per sweep and exit 0, and twice the default path rotted under it —
// green runs that had tested nothing (docs/CLAUDE_HISTORY.md §6, held by t133_wtdir).
//
// Two kinds of test are deliberately NOT part of the exit code:
//   * the browser test (t28) needs WebGL. Its Node half only writes a page, so running it here
//     would report "pass" for something nobody looked at. It is generated and its path printed.
//   * report-only tools (t16 profiler, t17/t18/t19/t20) print findings and have no pass/fail.
import fs from "fs";
import path from "path";
import { spawn, execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { findInstall, describeInstall, InstallError } from "./wtdir.mjs";
import { verdict } from "./verdict.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// `--only=ids` is `--only ids`, and an option this file does not know is refused. Until 2026-10-10
// the equals form was read as nothing at all, so `npm test -- --only=arms` with no install ran the
// whole install-free suite and exited 0 although an install test had been named (final audit).
const KNOWN = new Set(["--all", "--verbose", "-v", "--list", "--only"]);
const argv = process.argv.slice(2).flatMap(a => a.startsWith("--only=") ? ["--only", a.slice(7)] : [a]);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--only") { i++; continue; }
  if (!KNOWN.has(argv[i])) {
    console.error(`unknown option "${argv[i]}" — tools/all.mjs takes --all, --list, --verbose and --only <ids>; nothing was run`);
    process.exit(2);
  }
}
const ALL = argv.includes("--all");
const VERBOSE = argv.includes("--verbose") || argv.includes("-v");
const LIST = argv.includes("--list");
const ONLY = (() => {
  const i = argv.indexOf("--only");
  if (i < 0) return null;
  const ids = (argv[i + 1] || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!ids.length) { console.error("--only needs a comma-separated list of test ids (see --list)"); process.exit(2); }
  return ids;
})();

let install;
try { install = findInstall(); }
catch (e) {
  if (!(e instanceof InstallError)) throw e;
  console.error("MISCONFIGURED  " + e.message);
  process.exit(2);
}
const haveInstall = !!install.dir;

// Two tests check what only the author's repository has: its internal docs ("claims") and the
// whitelist of what is public ("public"). The public repository is made without them (.public), so
// there they are said not to run, never counted as passed; here they always run. .public is what
// tells the two apart — on disk or in the index here, and in no public copy.
const AUTHOR_REPO = fs.existsSync(path.join(ROOT, ".public")) || (() => {
  try { return execFileSync("git", ["ls-files", "--", ".public"], { cwd: ROOT, encoding: "utf8" }).trim() === ".public"; }
  catch { return false; }  // no git here, or no repository: a downloaded copy of the public tree
})();

// heap: the roster sweeps hold the whole index in memory, so they get what their own docs specify
const M = mb => ["--max-old-space-size=" + mb];

const SUITE = [
  // ---- install-free: these gate every commit -------------------------------------------------
  // First: the page every other test reads is the one src/ builds. A stale artifact would make
  // every result below it describe code that is not the source any more.
  { id: "build",    file: "t41_build.mjs",         args: [], node: [],       needsInstall: false,
    what: "the committed wt_skin_studio.html is exactly what src/ builds, names nothing off the machine to load (tags, CSS, refresh), carries three.js and JSZip as their pinned bytes with their notices, and the --cdn page says it needs the network (gate for ROADMAP 2.1, 4.50 (1))" },
  { id: "check",    file: "check.mjs",             args: [], node: [],       needsInstall: false,
    what: "every inline <script> in the page parses" },
  { id: "encode",   file: "t29_encode.mjs",        args: [], node: [],       needsInstall: false,
    what: "export encoders vs golden bytes + round trips (gate for ROADMAP 1.3)" },
  { id: "validate", file: "t30_validate.mjs",      args: [], node: [],       needsInstall: false,
    what: "export validator against every publishing rule in CLAUDE.md §1" },
  { id: "decaltree",file: "t34_decalfolders.mjs",  args: [], node: [],       needsInstall: false,
    what: "decal library folder tree: rename, delete, move, legacy entries" },
  { id: "dds",      file: "t23_dds.mjs",           args: [], node: [],       needsInstall: false,
    what: "DDS block decoders byte-for-byte against HEAD" },
  { id: "symmetry", file: "t39_symmetry.mjs",      args: [], node: [],       needsInstall: false,
    what: "the mirror plane is measured, not the bounding-box centre (gate for ROADMAP 4.6)" },
  { id: "cache",    file: "t21_cache.mjs",         args: [], node: M(4096),  needsInstall: false,
    what: "stored game index round trip at real-install size, counting the texture packs and not the model packs beside them, each unit's own model with it — none kept from a read that was empty or left a blk unread" },
  // Before any of the browser tests: if the harness attaches to the wrong execution context, they
  // all fail at attach with an error that points nowhere near their own code.
  { id: "harness",  file: "t43_harness.mjs",       args: [], node: [],       needsInstall: false,
    what: "the CDP harness evaluates in the page's document, not the initial empty one" },
  { id: "boot",     file: "t31_boot.mjs",          args: [], node: [],       needsInstall: false,
    what: "the page boots in headless Chrome with the network off: no uncaught errors, three.js and JSZip at their pins, no request made by the page or its workers, and a damaged copy says so (gate for 4.50 (1))" },
  { id: "pool",     file: "t32_pool.mjs",          args: [], node: [],       needsInstall: false,
    what: "worker pool: section lift, transfers, ordering, cancel, inline fallback" },
  { id: "export",   file: "t33_export.mjs",        args: [], node: [],       needsInstall: false,
    what: "worker export is byte-identical to the main-thread encoder" },
  { id: "decode",   file: "t37_decode.mjs",        args: [], node: [],       needsInstall: false,
    what: "worker decode is byte-identical to the main-thread decoder (gate for ROADMAP 1.2)" },
  { id: "occlusion",file: "t38_occlusion.mjs",     args: [], node: [],       needsInstall: false,
    what: "the projector paints only the first surface each ray meets (gate for ROADMAP 4.2)" },
  { id: "exppick",  file: "t40_exportpick.mjs",    args: [], node: [],       needsInstall: false,
    what: "leaving a texture out drops its .blk line with it (gate for ROADMAP 4.5); To War Thunder never dead-ends — a game folder opened another way offers the .zip at once with no picker, and the UserSkins folder can still be chosen from that dialog, a picked install root or folder above it writes into its own UserSkins and any other folder is refused, a cancelled or missing picker offers the zip too — and through stand-in handles that log every call, the only things it creates or writes are UserSkins/ and UserSkins/<name>/ (CLAUDE.md §0.4)" },
  { id: "nooodle",  file: "t42_nooodle.mjs",       args: [], node: [],       needsInstall: false,
    what: "a build with no decoder at all still degrades honestly — the scan's summary and Fill missing slots keep the Oodle cause apart (gate for ROADMAP 5.2; review of 2026-10-10)" },
  { id: "decallib", file: "t35_decallib.mjs",      args: [], node: [],       needsInstall: false,
    what: "decal library against real IndexedDB and the real dialog" },
  { id: "drop",     file: "t36_drop.mjs",          args: [], node: [],       needsInstall: false,
    what: "drag & drop: loose files bypass the entries API, failed folder walks are reported" },
  { id: "panels",   file: "t44_panels.mjs",        args: [], node: [],       needsInstall: false,
    what: "the sidebar panels render the markup they did before (gate for ROADMAP 2.4, 4.28)" },
  { id: "memory",   file: "t45_memory.mjs",        args: [], node: [],       needsInstall: false,
    what: "repeated encodes give their memory back, and the measurement can see a leak" },
  { id: "wtlz",     file: "t46_wtlz.mjs",          args: [], node: [],       needsInstall: false,
    what: "the shipped build carries the project's own Oodle decoder, no one else's, byte-identical to RAD's (gate for ROADMAP 5.1, 5.4)" },
  { id: "stroke",   file: "t47_stroke.mjs",        args: [], node: [],       needsInstall: false,
    what: "a brush stroke does not stall the window — plain, with Flow and pressure, and with a tip and every dynamic on — and undo puts back exactly what was there (§3.3, ROADMAP 4.50 (4), (10))" },
  { id: "family",   file: "t49_family.mjs",        args: [], node: [],       needsInstall: false,
    what: "a .blk only names textures the vehicle it is written for actually has (ROADMAP 4.7); the vehicle list puts each unit on the model its own blk names, boat_a takes no \"a…\" unit by name, a unit's blk outranks a perfect name match, rows alike but for the model are twins led by what tells them apart, and a load ticks exactly the units whose blk names the model, a ranked one with a real class first; the unit blks are read in a worker pool, an unreadable one is said, and none when the stored index has them (review of 2026-10-10)" },
  { id: "camera",   file: "t48_camera.mjs",        args: [], node: [],       needsInstall: false,
    what: "panning slides across the view, the cursor says which mode you are in, the loadout view fits the model (ROADMAP 3.8, 3.9, 4.38)" },
  { id: "controls", file: "t50_controls.mjs",      args: [], node: [],       needsInstall: false,
    what: "controls say what they actually do (ROADMAP 3.10, 3.11, 3.13-3.17, 3.20, 3.29, 3.30, 4.2, 4.8, 4.41, 4.50 (17)); the ? guide closes on a real Escape, opens above the windows, leaves Escape to a dialog, menu or Messages over it and a window under it to last, and the markup has no inline handler" },
  { id: "compose",  file: "t52_composite.mjs",     args: [], node: [],       needsInstall: false,
    what: "a dirty-rectangle composite equals the whole-sheet one, on every channel (ROADMAP 1.10)" },
  { id: "decalsurf",file: "t58_decalsurf.mjs",     args: [], node: [],       needsInstall: false,
    what: "a decal's Look lands as derived channels of the decal's own layer, all four of them follow it, and they are the pixels the old bake wrote (ROADMAP 4.8, 4.28(f), 4.50a)" },
  { id: "groups",   file: "t57_groups.mjs",        args: [], node: [],       needsInstall: false,
    what: "layer groups composite as a group, a project round trip keeps them, a layer masks another by reference, and a stored v5 .wtproj still loads (ROADMAP 4.9, 4.28, 4.36, 5.3)" },
  { id: "marquee",  file: "t59_marquee.mjs",       args: [], node: [],       needsInstall: false,
    what: "the selection is whole texels with no seam, and crop is one verb on it (ROADMAP 4.10)" },
  { id: "uvmask",   file: "t60_uvmask.mjs",        args: [], node: [],       needsInstall: false,
    what: "a part's UV stencil keeps its mirrored half, so the brush can reach it (ROADMAP 4.22)" },
  { id: "tools",    file: "t61_tools.mjs",         args: [], node: [],       needsInstall: false,
    what: "every tool x channel x target pair resolves or refuses in words (ROADMAP 4.28(d))" },
  { id: "view2d",   file: "t62_view2d.mjs",        args: [], node: [],       needsInstall: false,
    what: "the 2-D view draws what it says: compare, channel, coverage, mask tint, decal outline, ring" },
  { id: "skinload", file: "t63_skinload.mjs",     args: [], node: [],       needsInstall: false,
    what: "loading a skin puts each file where its .blk says, and a camo line is a pin (ROADMAP 2.4)" },
  { id: "ctlnames", file: "t64_ctlnames.mjs",     args: [], node: [],       needsInstall: false,
    what: "a control surface's node name lands on its control, in every shape the roster uses (ROADMAP 4.42)" },
  { id: "bake",     file: "t66_bake.mjs",          args: [], node: [],       needsInstall: false,
    what: "masks baked from the model: curvature reads 1/R and finds creases convex, occlusion darkens what sits under a roof (ROADMAP 4.44)" },
  { id: "decalstyle", file: "t67_decalstyle.mjs",  args: [], node: [],       needsInstall: false,
    what: "a decal's outline and shadow: drawn round the marking without moving it, the same size through the projector, the shadow kept out of the footprint (ROADMAP 4.44)" },
  { id: "tone",     file: "t68_tone.mjs",          args: [], node: [],       needsInstall: false,
    what: "blend-if: a layer shown by the tone or colour beneath it, in a band with a ramp, multiplied with its mask, the same on the region path (ROADMAP 4.44)" },
  { id: "stack",    file: "t69_stack.mjs",         args: [], node: [],       needsInstall: false,
    what: "a group saved as a .wtstack comes back whole onto another sheet — resampled, renumbered, projections flattened, foreign part names dropped, and said so (ROADMAP 4.44)" },
  { id: "layered",  file: "t101_layered.mjs",      args: [], node: [],       needsInstall: false,
    what: "a texture's stack out as OpenRaster and as PSD and back: the zip and stack.xml as the format requires (DOMParser the oracle), a PSD reader, writer and renderer written from the spec in the test, each format drawing the app's composite from the file alone, stencils and effects in the pixels, pass-through kept, what Photoshop, Krita and GIMP write landing with every loss said, and the worker and inline paths writing the same bytes (ROADMAP 4.50 (16))" },
  { id: "clone",    file: "t70_clone.mjs",         args: [], node: [],       needsInstall: false,
    what: "the Clone brush copies the sheet at the offset the first stamp fixed, stays aligned across strokes, never reads its own output, matches tone when asked, and works on the normal map (ROADMAP 4.44)" },
  { id: "adjust",   file: "t92_adjust.mjs",        args: [], node: [],       needsInstall: false,
    what: "effect kinds — Levels, Curves, colour balance, gradient map, invert, threshold, posterize: each table exact under Node, region = whole on every kind, a mask and a Limit confine it, the GPU pass = the CPU pass on every texel and in a composite, saved at version 5, the panel reaches linked siblings (ROADMAP 4.50 (5))" },
  { id: "gradient", file: "t74_gradient.mjs",      args: [], node: [],       needsInstall: false,
    what: "gradient fills: the stops as one table, on the sheet or along the model through the position bake, cached per record, repeat and reflect, dithered, saved at version 5 (ROADMAP 4.44)" },
  { id: "pattern",  file: "t94_pattern.mjs",       args: [], node: [],       needsInstall: false,
    what: "noise and pattern fills along the model: seeded, in metres, one contrast at any detail, seamless across UV islands, streaks along the up axis; worked out in the fill pool byte-for-byte as the main thread would, with the progress bar and Cancel past 200 ms; tri-planar by the bake's new normal plane, filtered when shrunk, the tile kept in the workers; a pattern on the sheet repeats whole tiles; masks and chipped paint, save, convert, export wait (ROADMAP 4.50 (7), (8))" },
  { id: "radial",   file: "t75_radial.mjs",        args: [], node: [],       needsInstall: false,
    what: "radial symmetry: N copies of a stroke turned about a picked axis — the turn comes home, keeps its radius, spaces evenly, commutes with the mirror on the axle, and costs no more rays (ROADMAP 4.44)" },
  { id: "tankrig",  file: "t76_tankrig.mjs",       args: [], node: [],       needsInstall: false,
    what: "the tank rig comes from the unit's own datasheet: the turret carries the gun and the barrel, the gun turns about the trunnion, the travel is the vehicle's own and the depression follows the hull (ROADMAP 4.1)" },
  { id: "pose",     file: "t77_pose.mjs",          args: [], node: [],       needsInstall: false,
    what: "applyPose: a baked delta reaches the mesh conjugated by diag(1,1,-1), an inferred hinge turns about its pivot, and a part no longer posed goes back (ROADMAP 2.4)" },
  { id: "tracks",   file: "t78_tracks.mjs",        args: [], node: [],       needsInstall: false,
    what: "the generated track ribbon wraps every wheel, is two-sided, sits in the widest wheel's z band, and V is arc length (ROADMAP 2.4)" },
  { id: "project",  file: "t79_project.mjs",       args: [], node: [],       needsInstall: false,
    what: "what the canvas projector decides: facing, depth, a triangle bigger than the image, the layer's own scope over the live one, the dry run agreeing, the box, and every UV tile (ROADMAP 2.4)" },
  { id: "scan",     file: "t80_scan.mjs",          args: [], node: [],       needsInstall: false,
    what: "what the game-folder scan says when it finishes: a line that counts what the list lists, the units it leaves out, the stored-index note, the textures not opened — per texture, with their format names — the same from a restored index as from a fresh scan, a dropped or chosen folder, an install found below the folder that was picked, and a folder that yielded nothing; and a utility sheet on its slot, its texture row (also behind an empty $hq stub), a vehicle's load and Fill missing slots (ROADMAP 2.4, 4.48; review of 2026-10-10)" },
  { id: "acl",      file: "t81_acl.mjs",           args: [], node: [],       needsInstall: false,
    what: "one ACL key frame: constant, packed, segment-constant and raw, through both ranges, with w rebuilt — against buffers the test lays out itself (ROADMAP 2.4)" },
  { id: "path",     file: "t82_path.mjs",          args: [], node: [],       needsInstall: false,
    what: "the shape tool: the model (a straight segment stays two points, a cubic hits its midpoint, a walk spaces evenly across corners) and both verbs in the page — a closed path filled in ONE fill with no pale seam, and the brush walked along it at its own spacing (ROADMAP 6.1)" },
  { id: "path3d",   file: "t132_path3d.mjs",       args: [], node: [],       needsInstall: false,
    what: "the shape tool on the model: nodes laid and closed by pointer events on the 3-D view in a plane fixed at the first click; Fill projects the path through the decal projector — a square across a UV seam fills both islands, nothing on a plate behind it (the depth pre-pass) or past its edge 1 m back (the depth limit, which follows the nodes), hardened to 0 or 255, one undo step; Stamp along lays 24 separate stamps along 3 m at 1/8 m; → selection selects both islands; a path stays in the view it was started in (ROADMAP 6.1b)" },
  { id: "selshape", file: "t99_selshape.mjs",      args: [], node: [],       needsInstall: false,
    what: "selections from a lasso, a path and a colour range: a polygon covers exactly the texel centres a winding-number oracle says (nonzero, as the path's Fill), the wand's tolerance and edge-only connectivity read band by band as in one call, Shift adds / Alt removes as one step holding packed bits and a Shift or Alt that changes nothing changes nothing, path → selection covers what Fill paints; on a 4096² sheet the selection is the sheet's own texels — two touching patches recoloured with the wand and Fill leave no seam — and a click reads a band at a time from a copy made when clicked; the wand reads what the 2-D view shows: the camouflage blend by the eyedropper's arithmetic, a smoothness brush, a channel view; and a click on a camouflage tile's repeat takes the tile's own texel, one period over (ROADMAP 4.50 (9))" },
  { id: "mirror",   file: "t83_mirror.mjs",        args: [], node: [],       needsInstall: false,
    what: "symmetry on the sheet: a texel maps to its own reflection, a match further than three of this sheet’s own texels is refused, a competing region 20 mm away does not win, and a stroke jumps rather than drawing a line to its copy (ROADMAP 6.2)" },
  { id: "listed",   file: "t84_listed.mjs",        args: [], node: [],       needsInstall: false,
    what: "a game folder chosen through the file chooser answers like a directory handle, the real scan walk and fingerprint run over it, and every way in offers it — the Program Files install a double-clicked page could not reach (ROADMAP 4.48); a folder picked ABOVE the install (a Steam library, common, a drive) finds it by name with no walk and remembers the install, a folder inside it is told to pick the one above, a sibling Gaijin game is not taken for it, the remembered install reopens, and Load a skin opens in UserSkins" },
  { id: "status",   file: "t87_status.mjs",        args: [], node: [],       needsInstall: false,
    what: "every status message can be read in full: the line takes the free width, a cut one opens on hover, a click shows the recent ones, and an error that does not fit opens by itself" },
  { id: "typein",   file: "t88_typein.mjs",        args: [], node: [],       needsInstall: false,
    what: "every slider shows its value and the value can be typed: click or Enter opens it, in the readout's own units (data-k, checked against every readout), clamped, one input + one change; Esc and junk change nothing — and no text below 11 px, no tooltip over 300 characters" },
  { id: "effects",  file: "t89_effects.mjs",       args: [], node: [],       needsInstall: false,
    what: "a jet flame or gun flash is drawn from the game's own sheet the desc names: colour weighted by the sheet's alpha (by colour alone when it has none), rows uploaded bottom-up, kept through gcDecoded; the gradient only when there is no sheet" },
  { id: "browse",   file: "t90_browse.mjs",        args: [], node: [],       needsInstall: false,
    what: "the vehicle list can be browsed with nothing typed: every vehicle in tree order, a filter narrows it, 200 rows at a time behind a Show-more button an IntersectionObserver presses, and typing still searches (ROADMAP 3.38); a rankless unit follows the ranked ones, the lit rows are the units the skin is for and follow the ticks by an event, and a twin's subtitle leads with what tells it apart (review of 2026-10-10)" },
  { id: "handles",  file: "t100_handles.mjs",      args: [], node: [],       needsInstall: false,
    what: "a projected decal is handled directly: its corners and knob in 3-D are the projector's own frame and resize / turn it through real pointer events; on the sheet it drags to the surface under the texel — the side it started on, where one island is two surfaces a tile apart — and has the same handles through the plane→sheet map (mirrored, turned, oblique UVs), under the model's rule and its own pointer's, with a press on bare sheet reading no layer back; the slider gate cannot latch and, closed, leaves the thread twice a render slower than 250 ms; a decal deleted or undone away mid-drag stays gone; a drop keeps the Look showing (ROADMAP 4.2)" },
  { id: "autosave", file: "t93_autosave.mjs",      args: [], node: [],       needsInstall: false,
    what: "autosave and crash recovery: work in no file makes the page ask before it closes (undo back to the saved state does not, past an edit with no undo step it still does), a copy lands in IndexedDB after a few quiet minutes and when the tab is hidden, the last two per session within 1 GB, and after a real reload the welcome card recovers the same nodes through ProjNode and the next copy holds the page's own sources — without holding the UI thread (ROADMAP 4.50(2))" },
  { id: "reedit",   file: "t91_reedit.mjs",        args: [], node: [],       needsInstall: false,
    what: "a projected decal's image opens in the decal editor and Use re-projects it where it is: place and marking size kept through a crop (an uneven one too) or a turn, its depth map, a normal map's vectors and its outline following the edit, the Look rebuilt (kept when untouched, shown as Custom when no preset matches), one undo step holding the old image, the ProjSource API the text tool builds on, a .wtproj round trip (ROADMAP 4.2)" },
  { id: "text",     file: "t113_text.mjs",         args: [], node: [],       needsInstall: false,
    what: "text is a decal drawn from a record: a font the test builds, loaded through FontFace, lays out to the pixel (tracking, leading, alignment, several lines, Hebrew and Arabic in the order they are read, tracked or not) against a reference at the font's own numbers; the Text button's dialog, Use, and floating re-edits — turned, flipped, mirrored — and projected ones in one step each (frame and letter size kept, the aligned edge and the first line held, a depth image moved with the lettering, Use refused on a text gone or changed under its dialog); a .wtproj — and the recovery copy — carries the record and the font file with its licence note, and re-draws the stored image after the font is gone from the page; the library and a .wtstack keep text as text; with real key events, T types no t and a dialog owns the keys while it is up (ROADMAP 4.50 (3))" },
  { id: "pen",      file: "t95_pen.mjs",           args: [], node: [],       needsInstall: false,
    what: "pen pressure, smoothing and Flow: a pen stroke with rising pressure widens monotonically and a mouse is the full brush, through both views' own pointer handlers; Flow builds within a stroke up to Opacity, Build up past it, a Fill at Opacity in both; the string holds the brush back; the 3-D walk carries pressure at the chord's ray budget; a Shift+click line starts at the click's pressure; a 3-D copy on texels the stroke shares is laid once (ROADMAP 4.50 (4), 6.4)" },
  { id: "tips",     file: "t131_tips.mjs",         args: [], node: [],       needsInstall: false,
    what: "brush tips and dynamics: the four built-ins as coverage, an image read as a tip in all three conventions, the library in IndexedDB and in a settings file (not in localStorage), removing a tip puts its tools back on Round; the Round tip with no dynamics is the old stroke to the byte; a turned tip's corners are recorded, cleared and undone; Angle follows a stroke and Stamp along's path, reflected for the mirror up to an island's rim (read along the stroke's own surface and the twin's, not the padded gutter, a touching island, the twin's seams or a fold); scatter, size, flow and angle jitter show and a stroke is reproducible from its seed; the masked branch and the Clone take a tip; all of it per tool (ROADMAP 4.50 (10))" },
  { id: "camotile", file: "t106_camotile.mjs",     args: [], node: [],       needsInstall: false,
    what: "a scalable camouflage of your own: the .blk pins the tile by its exact name on the stems the unit's own skins replace, a stroke over the right edge lands on the left (the Clone's source and destination, paths, flat decals — converted or exported on the sheet too — and one undo takes both halves back), it starts seamless and stays square, the view draws it 3 × 3; read out of the real export's zip, the real .wtproj round trip (its alpha kept) and the viewport's material; nothing to pin is said, it goes with its vehicle, and the model samples it through tc1 — format 4's first four bytes (ROADMAP 4.50 (6))" },
  { id: "search",   file: "t96_search.mjs",        args: [], node: [],       needsInstall: false,
    what: "search that forgives, one search over both lists: the matcher against a fixed unit list (exact, prefix, words, contains, near — letters forgiven, digits never; roman marks with a letter or past ten answer to their digits; inside a tier the name on screen before the ids, a word's edge a step up; one letter a whole word, a nation from three letters), then every control in the page driven the way a user does with the lists read straight after it: a chip splits both lists at once, what it leaves out after what it keeps, raw textures after the vehicles, four sorts over both lists, reset, Reset all settings and a settings file redraw both, chunks across groups, a rescan lists the new records (ROADMAP 3.5, 3.28(5)); a merged row is found by every unit's id and full name (review of 2026-10-10)" },
  { id: "sidebar",  file: "t102_sidebar.mjs",      args: [], node: [],       needsInstall: false,
    what: "the sidebar stands still and only the results scroll: at 1920 x 1080 the two lists are the column's only scrollers and share it 3:2, a short or folded one gives its height back, the bar follows a real mouse drag, every right-column section sits in its one pane; at a 1366 x 768 laptop and at 1280 x 720 the column scrolls as a last resort, the vehicle list keeps its floor (210 px on a tall page, five rows on a short one) and only the search box's line is sticky, so no list slides under it (ROADMAP 3.6); every vehicle name in a row is whole and its download icon is 4.5:1 at rest, hovered and selected, its own opacity counted; a dialog's choice row keeps its hover-only verb; below an 810 px page the nation and rank chips fold behind one chip (click, Enter, Space), a 1366 x 768 page fits the whole tab with five vehicle rows, the laptop's shows Existing skin, and the bar follows a drag from the lists' floors; on 1366 x 650, 1280 x 600 and 1280 x 592 pages the vehicle list shows five whole rows of the same type with the Existing skin heading in view, giving way before the heading on a 569 px page, and a section folded there has no gap under its heading and leaves the tab fitting at 1280 x 600, 592 and 1366 x 768 (2026-10-10)" },
  { id: "fit",      file: "t133_fit.mjs",          args: [], node: [],       needsInstall: false,
    what: "everything fits, at a maximised window on 2560, 1920, 1366 and 1280 screens: the top bar one row at its widest (and across 1280–1800 either side of its two steps), the 3-D view's bar one line in Split whichever channel view it shows (two at 960), no sideways scroll; every layer kind's and every brush tool's controls inside the column with its scrollbar up, no button over two lines, every layer row's name shown, the Layers buttons and the Slots header one line; the brush hint under the tools, a selected-but-unavailable tool drawn as off, the tip preview on a clear ground, the tool grid the same on a tank and an aircraft; the Weapons line names the vehicle, keeps hyphenated names whole, stays in its column with a long id, and prints the max load like the Mass line, and the Vehicle and Weapons buttons are capitalised alike (UI review, 2026-10-10)" },
  { id: "resilience", file: "t86_resilience.mjs",  args: [], node: [],       needsInstall: false,
    what: "one unreadable piece costs that piece, not the vehicle: an unknown vertex format drops its part, a garbage skeleton or clip drops itself, and the load says what was left out and that Add files… still works (ROADMAP 4.4)" },
  { id: "loadout",  file: "t73_loadout.mjs",       args: [], node: [],       needsInstall: false,
    what: "a hardpoint picked is hung at once and alone: the diff, the take-down, the game-style menu with Ammo and Mass, the queue, no Apply (2026-09-21)" },
  { id: "cockpit",  file: "t71_cockpit.mjs",       args: [], node: [],       needsInstall: false,
    what: "the cockpit is a second body of the same vehicle: the switch swaps geometry and keeps each body's parts and selection, shared sheets are one slot, the seat is headPos in app space, and the project carries both (ROADMAP 4.14)" },
  { id: "transfer", file: "t104_transfer.mjs",     args: [], node: [],       needsInstall: false,
    what: "the cockpit carried onto the exterior's interior sheet: nearest surface by tree = by brute force, a texel's point exact, glass, hidden, effect and unposed parts lend nothing, the sheet's own paint passes through and the texels the cockpit renders there are never written, the source read at the texel's footprint, the worker's bytes = the pure section's, one bake owns the worker and every cancel lands, and the dialog's Add as layer (ROADMAP 4.45)" },
  { id: "undo",     file: "t56_undo.mjs",          args: [], node: [],       needsInstall: false,
    what: "the undo history is budgeted in bytes, the ceiling is a setting, and it says so (ROADMAP 1.5)" },
  { id: "guides",   file: "t98_guides.mjs",        args: [], node: [],       needsInstall: false,
    what: "the 2-D view's rulers, guides and pixel grid: a guide out of either ruler lands on a whole texel as one undo step, its tab moves it and a ruler removes it; the marquee, shape-tool nodes and flat decals snap by every edge, Ctrl places freely; a checkpoint a guide throws away is said over its line; the grid shows past 600 % only (ROADMAP 4.50 (15))" },
  { id: "history",  file: "t97_history.mjs",       args: [], node: [],       needsInstall: false,
    what: "the undo history as a list: a click lands on its state, a checkpoint names a state and keeps it through its own step's eviction, a stale row walks nowhere, a long walk yields behind the progress bar, cancels, and stops where it is when a stroke, a press or a key is started during it (a key read with real input after a real click on a row, which keeps the focus), a closed window holds no step and is not refilled by a walk that ends after it closed, every clear is one funnel (ROADMAP 4.50 (15))" },
  { id: "prefs",    file: "t55_prefs.mjs",         args: [], node: [],       needsInstall: false,
    what: "every setting is one declared row, survives save/reset/load, and no reset fires unasked (ROADMAP 3.12, 3.11c, 3.19)" },
  { id: "surface",  file: "t54_surface.mjs",       args: [], node: [],       needsInstall: false,
    what: "the surface sheets are read as they are, with the two conversions in the shader (ROADMAP 1.13)" },
  { id: "slots",    file: "t53_slots.mjs",         args: [], node: [],       needsInstall: false,
    what: "a glass shader's coating map is not an albedo, so a canopy gets no blank slot (ROADMAP 3.18)" },
  { id: "wtdir",    file: "t133_wtdir.mjs",        args: [], node: [],       needsInstall: false,
    what: "the tests find the install themselves and can never pass green with a wrong one: tools/wtdir.mjs finds the game in a second Steam library by libraryfolders.vdf (not without it), prefers the library the list ties to app 236390, refuses one that lists it but lacks aces.vromfs.bin or content/base/res, follows the manifest's installdir, asks the registry only when Steam's folder has no list, and throws on a WT_DIR that is not an install; all.mjs fails every mode on such a WT_DIR and --all with no install, in one line with nothing run; no install test passes over a folder holding only those two markers; the install tools exit non-zero and say why" },
  { id: "claims",   file: "t51_claims.mjs",        args: [], node: [],       needsInstall: false, internal: true,
    what: "CLAUDE.md's numbers are measured from the code, not remembered; the user's guide names the app's version, opens on Quick start and describes a decal's Look as the code builds it" },

  { id: "public",   file: "t139_public.mjs",       args: [], node: [],       needsInstall: false, internal: true,
    what: "what the public repository carries is .public's whitelist and holds: everything a public clone needs is public and nothing it does not need is, nothing public carries a personal marker, ooz's or RAD's bytes or a reference to a private file, and the commit and push hooks that hold it are installed (ROADMAP Phase 5, 2026-10-10)" },

  // ---- needs a War Thunder install ------------------------------------------------------------
  { id: "arms",     file: "t12_verify.mjs",        args: [], node: M(4096),  needsInstall: true,
    what: "armament over the whole roster" },
  { id: "onpylon",  file: "t14_onpylon.mjs",       args: [], node: M(4096),  needsInstall: true,
    what: "store lands on the rack the model already carries" },
  { id: "parts",    file: "t15_parts.mjs",         args: [], node: M(6144),  needsInstall: true,
    what: "parts tree naming, ordering and same-geometry detection" },
  // "rig", not "pose": t77 has that id, and `--only` matches every entry with the id it is given —
  // so `--only pose` ran this roster sweep as well, or refused outright on a machine without the
  // install, when what was asked for was the 2-second install-free test.
  { id: "rig",      file: "t22_pose.mjs",          args: [], node: M(6144),  needsInstall: true,
    what: "the moving-parts rig, baked and inferred" },
  { id: "placement",file: "t26_placement.mjs",     args: [], node: M(6144),  needsInstall: true,
    what: "suspended armament: mirror parity and pod tube runs" },
  { id: "a2d",      file: "t27_a2d.mjs",           args: [], node: M(6144),  needsInstall: true,
    what: "baked animation: ACL bit walk, translations, rotations, semantics" },
  { id: "hardpoints", file: "t65_hardpoints.mjs",  args: [], node: M(4096),  needsInstall: true,
    what: "the Weapons tab's hardpoint row is the right way round on every aircraft (ROADMAP 4.38)" },
  { id: "listedinstall", file: "t85_listed_install.mjs", args: [], node: [], needsInstall: true,
    what: "the file chooser handed the real install, on a file:// page: the whole scan through it, then a vehicle's geometry and full-size sheets (ROADMAP 4.48); then the same install from the stored index, which says what the fresh scan said, with the textures not opened checked against every listed vehicle's body and camouflage sheets, every one's texture row naming its format, and Fill missing slots on a propeller aircraft counting its utility sheets apart (review of 2026-10-10)" },
  { id: "cockpitroster", file: "t72_cockpitroster.mjs", args: [], node: M(4096), needsInstall: true,
    what: "<model>_cockpit exists for 97 % of flying units, headPos for 99 % of cockpit blocks, and the F-4E's seat sits in its cockpit, which shares the exterior's sheet and box (ROADMAP 4.14)" },
  { id: "transferf4", file: "t103_transferf4.mjs", args: [], node: M(6144), needsInstall: true,
    what: "on the F-4E the carried cockpit reads as the first-person one from the Pilot's seat on the exterior — |ΔRGB| over 8×8 blocks about halved against the stock interior sheet (ROADMAP 4.45)" },
  { id: "join",     file: "t138_join.mjs",         args: [], node: M(4096),  needsInstall: true,
    what: "the vehicle list over the whole roster: every unit is on the model its own blk names, boat_a takes no \"a…\" vehicle, the F-4E, M1A2 SEPv3, Bf 109 F-4, Su-30SM2, Kurnass 2000, A-7E and A13 Mk I load their own models, no two rows are the same row, a merged row keeps every unit's full name, and every group of rows alike but for the model is a twin group whose tells differ in their first 6 characters" },
  { id: "layeredpsd", file: "t101_layered.mjs",    args: ["--install"], node: [], needsInstall: true,
    what: "every PSD a community skin ships in UserSkins, read in place: its layers composited by the app are the picture Photoshop saved in the file, premultiplied, within 3 levels (ROADMAP 4.50 (16))" },
];

// Written, not run: their PASS/FAIL lives in a browser.
const BROWSER = [
  { id: "projector",  file: "t28_projector.mjs",   what: "GPU projector vs the canvas rasteriser (WebGL)" },
];

// An id is how `--only` names a test, so two entries sharing one is two tests behind one name.
{
  const seen = new Set();
  for (const t of [...SUITE, ...BROWSER]) {
    if (seen.has(t.id)) { console.error(`test id "${t.id}" is used twice in tools/all.mjs — ids must be unique`); process.exit(2); }
    seen.add(t.id);
  }
}

let picked = SUITE.filter(t => (!t.needsInstall || ALL) && (!t.internal || AUTHOR_REPO));
const notHere = SUITE.filter(t => t.internal && !AUTHOR_REPO);
if (ONLY) {
  const known = new Set([...SUITE, ...BROWSER].map(t => t.id));
  const unknown = ONLY.filter(id => !known.has(id));
  if (unknown.length) {
    console.error(`unknown test id(s): ${unknown.join(", ")}\nknown: ${[...known].join(" ")}`);
    process.exit(2);
  }
  // Named ids run whether or not they need the install — asking for one by name IS the opt-in.
  picked = SUITE.filter(t => ONLY.includes(t.id));
  const absent = picked.filter(t => t.internal && !AUTHOR_REPO);
  if (absent.length) {
    console.error(`FAIL  ${absent.map(t => t.id).join(", ")} check${absent.length > 1 ? "" : "s"} files only the author's repository has, and this is not it`);
    process.exit(2);
  }
  const needy = picked.filter(t => t.needsInstall && !haveInstall);
  if (needy.length) {
    console.error(`FAIL  ${needy.map(t => t.id).join(", ")} need${needy.length > 1 ? "" : "s"} the War Thunder install, and there is no War Thunder install: ${install.reason}`);
    process.exit(2);
  }
}

if (LIST) {
  console.log(`install: ${describeInstall(install)}\n`);
  for (const t of SUITE) {
    const skip = t.internal && !AUTHOR_REPO ? "author's repo only"
      : t.needsInstall && !ALL ? "not run (needs --all)"
      : t.needsInstall && !haveInstall ? "FAILS (no install)" : "run";
    console.log(`  ${t.id.padEnd(10)} ${skip.padEnd(22)} ${t.what}`);
  }
  for (const t of BROWSER) {
    console.log(`  ${t.id.padEnd(10)} ${"generate only".padEnd(22)} ${t.what}`);
  }
  process.exit(0);
}

// --all promises the install tests. Without an install, the honest answer is a failure before any
// of them starts — not a run of the install-free half that ends in "N/N passed".
if (ALL && !ONLY && !haveInstall) {
  console.error(`FAIL  --all runs the ${SUITE.filter(t => t.needsInstall).length} install tests, and there is no War Thunder install: ` +
    `${install.reason}. Set WT_DIR, or run npm test for the install-free suite.`);
  process.exit(2);
}

// Each install test is handed the one path printed above, so none of them can find another.
const run = (t) => new Promise(resolve => {
  const started = Date.now();
  const env = t.needsInstall ? { ...process.env, WT_DIR: install.dir } : process.env;
  const p = spawn(process.execPath, [...t.node, path.join(ROOT, "tools", t.file), ...t.args],
    { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", d => { out += d; if (VERBOSE) process.stdout.write(d); });
  p.stderr.on("data", d => { out += d; if (VERBOSE) process.stderr.write(d); });
  p.on("error", e => resolve({ code: -1, out: String(e.message), ms: Date.now() - started }));
  p.on("close", code => resolve({ code, out, ms: Date.now() - started }));
});

const tail = (s, n) => {
  const lines = s.trimEnd().split("\n");
  return lines.slice(-n).map(l => "        " + l).join("\n");
};

let failed = 0, ran = 0;
const results = [];

console.log(`node ${process.version}   mode: ${ALL ? "all" : "install-free"}\ninstall: ${describeInstall(install)}\n`);

for (const t of picked) {
  // overwrite the in-progress line only on a real terminal; piped into npm it just makes a mess
  const live = process.stdout.isTTY;
  if (live) process.stdout.write(`....  ${t.id.padEnd(10)} ${t.what}`);
  const r = await run(t);
  ran++;
  const secs = (r.ms / 1000).toFixed(1) + "s";
  const head = live ? "\r" : "";
  // A test that exits 0 after a SKIP that means nothing ran (an install test, or no browser at all)
  // is not a pass, whatever its exit code says — tools/verdict.mjs, held by t133.
  const v = verdict(t, r);
  if (v.state === "fail" && v.note) {
    console.log(`${head}FAIL  ${t.id.padEnd(10)} ${t.what} (${secs}) — ${v.note}`);
    results.push({ t, state: "fail", r });
    failed++;
  } else if (v.state === "pass") {
    console.log(`${head}PASS  ${t.id.padEnd(10)} ${t.what} (${secs})${v.note ? " — " + v.note : " ".repeat(4)}`);
    results.push({ t, state: "pass", r });
  } else {
    console.log(`${head}FAIL  ${t.id.padEnd(10)} ${t.what} (${secs}, exit ${r.code})`);
    if (!VERBOSE) console.log(tail(r.out, 14));
    results.push({ t, state: "fail", r });
    failed++;
  }
}

// The browser tests: generate the pages so the paths are current, but never claim a result.
// Under --only they are generated only when named — the point of --only is a short loop, and
// writing two pages nobody is going to open is the opposite of that.
if (!LIST) {
  const wanted = BROWSER.filter(t => !ONLY || ONLY.includes(t.id));
  if (wanted.length) console.log("");
  for (const t of wanted) {
    const r = await run({ ...t, node: [], args: [] });
    const m = /(\S+\.html)\s*$/m.exec(r.out.trim());
    // Exit 3 is "dormant by design", not a failure — a generator that has nothing meaningful to
    // compare says so in one line rather than emitting a page whose every check is a tautology. The
    // one that did (t24, deleted 2026-09-24, ROADMAP 2.4) is gone; the handling stays for the next.
    // Never silence, or a dormant test becomes an absent one.
    if (r.code === 3) console.log(`DORMANT ${t.id.padEnd(8)} ${r.out.trim().split("\n")[0].replace(/^t\d+:\s*/, "")}`);
    else if (r.code === 0 && m) console.log(`WROTE ${t.id.padEnd(10)} ${m[1]}  — open in a browser: ${t.what}`);
    else console.log(`ERR   ${t.id.padEnd(10)} could not generate (exit ${r.code})\n${tail(r.out, 6)}`);
  }
}

const passed = results.filter(r => r.state === "pass").length;
console.log(`\n${passed}/${ran} passed` + (failed ? `, ${failed} FAILED` : ""));
if (notHere.length && !ONLY) console.log(`(${notHere.map(t => t.id).join(" and ")}: check${notHere.length > 1 ? "" : "s"} files only the author's repository has — not run here)`);
if (ONLY) console.log(`(--only ${ONLY.join(",")} — this is NOT the gate; run the whole suite before calling a change done)`);
else if (!ALL) console.log(haveInstall ? "(install-dependent tests not run — use --all)"
  : "(install-dependent tests not run — no War Thunder install found; set WT_DIR to run them with --all)");
process.exit(failed ? 1 : 0);
