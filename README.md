# WT Skin Studio

A single-file browser editor for War Thunder user skins. Open
[`wt_skin_studio.html`](wt_skin_studio.html) in Chrome or Edge — that one file *is* the whole
application. Everything runs locally and nothing is uploaded. The game folder is only ever read:
the one thing written inside it is your skin's `UserSkins/<name>/` folder, when you export there.
It needs no connection either, not even the first time it is opened: the 3-D and zip libraries it
uses are inside that file too.

## Quick start

1. **Open War Thunder folder.** The app reads your install and indexes every vehicle, model
   and texture pack. Use **Chrome or Edge**: only they can open a folder, remember it and write
   into it (another browser reads the install through its file chooser and exports a `.zip`).
   Picking a folder *above* the install — the Steam library, `steamapps`, `common`, even the
   drive — finds War Thunder in the usual places inside it. The app remembers the folder, so later
   visits skip the picker; at most the browser wants one click on **Reopen War Thunder folder** to
   grant access again.
   **Installed under `C:\Program Files`?** (Every default Steam install is.) Chrome's folder
   picker refuses those ("…contains system files") — press **Open it another way…** instead. That
   is the browser's ordinary file chooser, which has no such rule: pick the *War Thunder* folder,
   the browser lists its files first (a few seconds), and it may ask whether to "upload" them —
   nothing is sent anywhere; that is its wording for letting a page read a folder. A folder opened
   this way is read-only and is picked again on each visit (the index is kept, so that is quick);
   see *Known limits*. Dragging the folder onto the window works only when the page is served
   over `http://`, not when the file is double-clicked.
2. **Search a vehicle by its real name** — "Abrams", "F-4E", "T-34" — and click it. The model
   geometry and its correct textures load straight from the game. The search forgives a typo or a
   missing hyphen ("abrahms", "f4e") and lists the skins in your UserSkins folder too. Or browse
   instead of typing: with nothing typed every vehicle is listed, and the type, nation and rank
   chips narrow it. A vehicle arrives as a **bare airframe**; the Weapons
   tab hangs a real loadout on it, hardpoint by hardpoint, the way the game's loadout screen does.
3. **Pick a texture slot and paint** — press <kbd>B</kbd> and paint in either view, on the sheet or
   directly on the model. Every brush writes to a layer; if there isn't one it makes it, so nothing
   is ever painted onto the game's own texture. A pen or stylus is pressure-sensitive, *Flow* builds
   a stroke up where it passes over itself, and *Smoothing* steadies a shaky line.
4. **Export as… ▸ To War Thunder** (at the foot of the Export window), then press *Update custom
   camouflage list* in the hangar. It writes `UserSkins/<name>/` straight into the install it found.
   Where the browser cannot write there — an install under `Program Files`, opened another way — it
   says so before encoding anything and offers **Download .zip** instead (with *Choose UserSkins
   folder…* beside it, for an install that is somewhere else). **Download .zip** works in every
   browser and on every install: the zip holds one folder, `<name>/`, so extract it *into*
   `War Thunder/UserSkins/` — the `.blk` must end up in `UserSkins/<name>/`. Windows' *Extract All*
   proposes a folder named after the zip, which nests it one level too deep; and under
   `Program Files`, Windows asks for administrator approval to write there.

**Where your files go.** Inside your War Thunder folder the app writes only `UserSkins/<name>/`, and
only when you press *To War Thunder*. Everything else — a `.wtproj`, a `.zip`, an OBJ, an exported
layer, your settings, a session recording — goes wherever your browser saves downloads. Reopen a
`.wtproj` with **Add files…** or by dragging it onto the window.

**Save proj** (<kbd>Ctrl</kbd>+<kbd>S</kbd>) writes a `.wtproj` with the model, the textures and
every edit in it. Until you do, the page asks before it closes, and every few minutes — and whenever
you switch away from the tab — it keeps a recovery copy of the work in the browser's own storage on
this machine. If the tab crashes, or is closed anyway, the welcome screen offers back the last copy
(see *Unsaved work* in [`docs/GUIDE.md`](docs/GUIDE.md)).

**Work in another editor too.** Right-click a layer ▸ *Export all layers for another editor* writes a
texture's layers as a `.psd` (Photoshop, Paint.NET, Photopea) or an `.ora` (Krita, GIMP, MyPaint)
that opens looking like the texture; dropping a `.psd` or `.ora` in brings its layers back as paint
layers.

The index of your install is stored after the first scan and restored in about a third of a second
on later visits; it refreshes itself when the game is patched (*Advanced ▸ Rescan install* forces
it).

Press <kbd>?</kbd> in the app for the full control list (<kbd>Esc</kbd> closes it).

**Reporting a bug.** Say which version (the welcome card shows it, e.g. `v1.0.0-beta.2 · own
decoder`), which browser and which vehicle, and what you did. <kbd>F12</kbd> ▸ *Console* shows any
error in red — copy it. For something slow or jumpy, *View & scene ▸ Advanced ▸ Record a session*,
press <kbd>F9</kbd> the moment it goes wrong, then stop it and attach the `.json` it saves. The app
sends nothing anywhere, so a report holds exactly what you put in it.

## The thing that trips everyone up: .blk names

War Thunder finds a skin by the **unit name** on the `.blk` file, which is usually *not* the
3-D model's name:

| model resource | file the game looks for |
| --- | --- |
| `f_4e` | `f-4e.blk` |
| `m1a2_sep3` | `us_m1a2_sep3_abrams.blk` *and* `uk_m1a2_sep3_abrams.blk` |
| `leopard_2a4` | `germ_leopard_2a4.blk`, `it_leopard_2a4.blk`, … |

The app reads the real unit registry out of `lang.vromfs.bin` and `char.vromfs.bin` and writes
the right filenames for you. Where several vehicles share one model (every F-16A, both
Leopard 2A4s, all six Fletchers) they are listed under **Skin & export ▸ Applies to** with the
confident matches pre-ticked.

## Ground vehicles vs aircraft

Per the official CDK rules the app applies these automatically:

- **Aircraft** export as `replace_tex` (only fixed skins are possible). An aircraft's albedo *is*
  its paint, so swapping the sheet is the whole skin.
- **Ground and naval** vehicles are painted from *two* textures — your sheet and the player's
  selected camouflage — so they need both halves, and the app writes both:
  `set_tex` with `param:t="camo_skin_tex"` puts your sheet in the user-skin slot (this is what
  keeps in-game decals working), and a `replace_tex` **pins** the camouflage so the skin does not
  come out a different colour for every player. *Skin & export ▸ Camo under skin* controls the
  second one and defaults to shipping a copy of the vehicle's **own** camouflage, so a skin you
  have not changed looks exactly like the stock vehicle. Pick *Solid colour…* to repaint the whole
  vehicle without touching the albedo at all — same as *Textures ▸ Whole-vehicle base colour*.
  Each camouflage the model uses is pinned separately: an M1A2's crew compartment takes
  `ger_camo_inside_elfebein` and does not get the exterior's colour painted inside it.
- **The albedo's alpha channel is the coverage mask** — the thing that trips everyone up. The game
  computes `mix(camouflage, your sheet, your sheet's alpha)`: white covers the camouflage, black
  lets it through. The app keeps the mask as a channel of its own, so painting colour — even
  flooding a hull with one opaque colour — never touches it. What the export writes into it is
  **Skin & export ▸ Alpha**. On a ground or naval skin, *Auto — opaque for ground* ships it fully
  opaque (255), as every published ground skin does: `set_tex` leaves the vehicle's own texture in
  place beside your sheet, and the worn edges, scratches and bare metal come from *that* texture's
  alpha — scaled by the in-game condition slider — not from yours. Your sheet's mask ships only
  when you paint one with the **Wear mask** brush, or set Alpha to *Keep the source / painted mask*,
  which keeps the mask the vehicle's texture came with. On an aircraft the sheet is the albedo, and
  *Auto* keeps its mask. *Textures ▸ Channels* shows the mask directly, and the viewport blends
  with the same setting — what you see is what the exported `.dds` contains.
- `_n` channel packing: **R** inverted roughness · **G**/**A** normal X/Y · **B** metallicity.
- **Every byte of both sheets is editable.** *Textures ▸ Channels* lists `_c` R/G/B/A and `_n`
  R/G/B/A with a thumbnail and mean for each: click to view one flat on the model, right-click to
  fill, invert, adjust, or put the stock coverage mask back. (On a ground skin an edit to `_c` A
  ships only once *Alpha* is set to *Keep the source / painted mask* — *Auto* ships it opaque.)

## Moving the model

**Moving parts** — a section of its own in the right column, under *View & scene*, which appears
once the loaded model has parts that move — swings the landing gear up, drops the flaps, opens a
canopy or a hatch and traverses a turret, so you can paint what the default pose hides. Which parts
belong to each assembly, where it pivots and around what axis all come out of the model's own
skeleton in the game files. How far each one travels is not in any readable file, so those ranges
are yours to set. Preview only — it never touches the exported skin.

## Layout

```
wt_skin_studio.html   the application — one self-contained file, and what you open
src/                  its source: index.html plus the 144 app modules it inlines, in load order —
                      codecs/ formats/ game/ editor/ view3d/ export/ ui/ core/ workers/ main.js
                      (and vendor/, from which the build picks one decompressor blob)
docs/GUIDE.md         the user guide, and what each internal build added
tools/                the build, the offline test suite, and the zstd-WASM build inputs
```

**Working on it.** Edit `src/`, then `npm run build` regenerates `wt_skin_studio.html` — or leave
`npm run dev` running and it rebuilds on save. There is nothing to install: the build is a
concatenation and the repo has no dependencies. Open the built file from disk, the way a user does;
`npm test` fails if it has drifted from `src/`, so a hand-edit of the artifact is caught rather than
quietly reverted later.

Verify a change without a browser: `node tools/check.mjs` syntax-checks every inline script in the
page, and `npm test` runs the offline suite, which re-uses the page's own functions under Node and in
headless Chrome. `npm run test:list` says what each test covers, and `npm run test:all` adds the
sweeps that read a real War Thunder install — armament, store placement, the parts tree, the
moving-parts rig.

## Known limits

- Only **LOD 0** and **rigid** meshes are extracted; skinned submeshes (camo nets, tarpaulins) are
  flagged and hidden rather than posed.
- Only **block-compressed** game textures are opened (DXT1/3/5, ATI1/2, BC5, BC7 — every vehicle
  colour, surface and camouflage sheet). The ~4 % in uncompressed or floating-point formats —
  vegetation wind tables, terrain masks, lookup tables, propeller masks — are listed by format name
  and not opened; the scan's message and *Advanced* count them, and a propeller mask's slot says
  *utility sheet*.
- *Moving parts* plays the vehicle's own baked animation, so a landing gear folds into its bay
  exactly as the game folds it, oleo and bogie included, and an exhaust nozzle's petals move
  individually. Vehicles the install ships no clip for, and imported `.obj` files, fall back to
  rotating each assembly about one inferred hinge with a conventional range (dimmed labels);
  tank turrets, guns and hatches always do, because a tank's clip carries only track roll.
- Tank tracks are **generated**: War Thunder builds the belt at runtime from the suspension nodes,
  so the app rebuilds a ribbon from the hull of the road wheels. The link tiling is derived from
  the texture's aspect and is close, not exact (*View & scene ▸ Track tiling* nudges it).
- The BC3 encoder is a simple min/max-endpoint fit; use the Lossless preset if you need exact
  colour.
- Paint strokes that cross a UV island border subdivide to at most 24 raycasts per pointer move,
  so a very fast flick with a small brush over heavily seamed geometry can still skip a stamp.
- **An install inside `Program Files` / `Windows` / `AppData` can be read, but never written
  to.** Chrome blocks its folder picker there entirely (use *Open it another way…*), and no
  browser can be granted write access — so *To War Thunder* offers **Download .zip** instead,
  and you extract it into `War Thunder/UserSkins/` (see *Quick start*, step 4). A folder opened
  another way (or dropped) also cannot be remembered for next time.
- **Folder access needs Chrome or Edge.** Another browser can still open the install with *Open it
  another way…* and export with *Download .zip*, but cannot write into a folder or remember one.

## One build, and it is ours to share

The app has to decompress Oodle to read anything out of the game's own packs, and which decoder is
inside a given `wt_skin_studio.html` decides whether that file may be handed to anyone.

| build | decoder | may be shared? |
|---|---|---|
| `npm run build` → `wt_skin_studio.html` | **the project's own**, `src/codecs/wtlz.js` — plain JavaScript, written from scratch | **Yes** — this is the artifact, and it is the default |
| `npm run build:ooz-page` → `dist/wt_skin_studio_ooz.html` | [ooz](https://github.com/powzix/ooz), GPL-3 | A diagnostic on the author's machine: ooz is not in the public repository, so a clone cannot build it |
| `npm run build:rad` → `dist/wt_skin_studio_rad.html` | RAD Oodle, from the Unreal Engine SDK | **No.** Personal use with your own install only |
| `npm run build:nooodle` → `dist/` | none | Yes, but it cannot read a modern install — it exists to keep the degradation path tested |
| `npm run build:cdn` → `dist/wt_skin_studio_cdn.html` | the project's own — the same page as the default, but fetching three.js and JSZip from cdnjs instead of carrying them | Yes, but its first open needs the network. It is the way back if a release ever wants the CDN |

**Since 2026-09-14 the decoder in the file you double-click is one nobody else wrote.** It was
built in a separate repository under a clean-room protocol — no existing implementation of the
format was read; every fact about the format came from experiments on the game's own files, each one
logged with its numbers — and it is byte-for-byte exact against the reference decoder on **every
compressed payload in a full install: 141 898 / 141 898 textures and 24 622 / 24 622 model streams**.
The two decoders it replaced are kept only as diagnostics for re-running that comparison after a game
patch: ooz (which had been the default since 2026-08-25, and is the reference ours was measured
against, kept on the author's machine) and RAD's blob, which is untracked, so a clone does not have it and does
not need it.

Do not publish a build with the RAD blob in it, and do not publish the ooz build unless GPL-3 is the
licence you mean. `tools/t46_wtlz.mjs` checks on every test run that the default build contains
neither.

## A promise about builds

**The build this repository makes is the complete editor, and it stays that way.** Everything that
makes a skin publishable — the export, the validator, the `.blk` writer, the channel semantics — is
never held back from it, in any build. If there is ever an earlier build for people who support the
project, it may arrive sooner and carry more; it will never be correct where this one is wrong. This
is written here so it is a promise rather than a habit.

## Licence

**GPL-3** — see [`LICENSE`](LICENSE). It was required
while ooz was linked; since 2026-09-14 nothing GPL-3 is in the page that ships, so it became a
choice again, and on 2026-10-03 it was chosen again: the editor was never going to be sold, and
copyleft stops a fork being closed and resold. One person holds the copyright to everything
`LICENSE` covers, which keeps a later change of licence possible; so outside code is taken only with
a line in its pull request granting the author the right to relicense it.

Two libraries by other authors are inside the page, both under the **MIT** licence:
**three.js r128** (Copyright 2010-2021 Three.js Authors) and **JSZip 3.10.1** ((c) 2009-2016
Stuart Knightley), which is dual-licensed MIT or GPL-3 and is used here under MIT, so it adds no
condition to whatever licence the project settles on. JSZip bundles pako, also MIT (Copyright (C)
2014-2017 by Vitaly Puzrin and Andrei Tuputcyn). All three notices and the MIT text head
`wt_skin_studio.html`.
The zstd decoder is Meta's, BSD-3/GPL-2. The RAD Oodle blob is the one thing here that is nobody's
to redistribute.

## How this was built

Heavily AI-assisted, and there is no reason to hide it. What is worth judging it on is checkable in one command: `npm test`
runs the offline suite with no install and no dependencies (`npm run test:list` prints what each
test covers), including golden-byte fixtures for every export encoder, worker-vs-main-thread byte
identity, a memory test with a control that is *required* to leak, a stored project file that
every later build has to keep reading, and a headless-Chrome boot that fails on any uncaught
error.
