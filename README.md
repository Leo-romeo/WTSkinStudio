# WT Skin Studio

**Make War Thunder skins in your browser.** Paint straight onto the 3-D model, place decals, and
export a ready-to-use `UserSkins` folder. One HTML file: no install, no account, works offline.

Free and open source (GPL-3). Unofficial: not affiliated with Gaijin Entertainment.

## What it does

- **Opens any vehicle from your own game install.** Search by its real name: aircraft, ground and
  naval. Hang real loadouts on the hardpoints, and swing the gear, flaps, canopy or turret to reach
  what the default pose hides.
- **Paints on the model or on the flat texture**, in layers with masks, groups and blend modes.
  Pressure-sensitive brushes, custom tips, symmetry, clone, gradients, pattern fills, procedural
  noise, Levels and Curves, and a path tool for camouflage shapes.
- **Decals** projected onto the model or laid flat, with a text tool and a decal library. A decal
  can be paint, vinyl or stencil, with its own gloss, metal and relief.
- **Every channel of both textures** (colour, coverage mask, roughness, metalness, normals) can be
  viewed on its own and edited.
- **Exports what the game expects:** the right `.blk` file names, the CDK's rules for aircraft and
  for ground vehicles, compressed `.dds` textures, and a size check against the game's limits.
- **Works with other editors:** layers out to `.psd` or `.ora`, and back in.

## Get started

1. Download [`wt_skin_studio.html`](wt_skin_studio.html) and open it in **Chrome or Edge**.
2. Click **Open War Thunder folder** and pick your install (or the Steam library it is in). The
   first scan indexes every vehicle; later visits open in a moment.
   - **Installed under `C:\Program Files`?** Chrome refuses that folder, so use **Open it another
     way…** instead. If the browser asks to "upload" files, nothing leaves your PC: that is its
     wording for letting a page read a folder.
3. **Search a vehicle** (`F-4E`, `Abrams`, `T-34`) and click it.
4. **Paint:** press <kbd>B</kbd> and paint on the model or on the 2-D sheet. Strokes always go onto
   a layer; the game's own texture is never changed.
5. **Export:** *Export* (the gear beside it opens the settings), then *Update custom camouflage list* in the hangar.
   If the browser cannot write into the game folder (a `Program Files` install, or Firefox), it
   offers **Download .zip**: extract it **into** `War Thunder\UserSkins\`, so the skin's folder
   lands there and not one level deeper.

**Updating:** click the version on the welcome card or at the right of the status bar. *What's new*
says what your build adds, and *Check for updates* shows what every newer build adds before you
download anything, with a link to its release page; download the new `wt_skin_studio.html` there
and use it in place of the old one. The check is the only time the app goes online, and only when
you click it; it sends nothing about you.

Save with <kbd>Ctrl</kbd>+<kbd>S</kbd>: a `.wtproj` holds the model, the textures and every edit.
Unsaved work is also kept as a recovery copy in the browser and offered back after a crash. Press
<kbd>?</kbd> for every control. The full manual is [`docs/GUIDE.md`](docs/GUIDE.md).

## Browsers

| | Chrome, Edge | Firefox and others |
|---|---|---|
| Read the game install | yes, remembered between visits | through *Open it another way…*, each visit |
| Export straight into `UserSkins` | yes, except into `Program Files` | no: download the `.zip` |

## Privacy and the game's files

- **Nothing leaves your PC.** No uploads, no telemetry, no account; it runs offline.
- **The game folder is only read.** The one thing written there is your skin's
  `UserSkins/<name>/`, when you export to it.
- **No game files are included.** The app reads your own install. War Thunder is a trademark of
  Gaijin Entertainment.

## Known limits

- **Textures raised to 8192 px:** decals can land offset and the app can stall. Stay at 4096 or
  below until this is fixed.
- Skinned meshes (camo nets, tarpaulins) are hidden, not posed.
- Tank tracks are rebuilt by the app, so their link tiling is close rather than exact
  (*View & scene ▸ Track tiling*).
- About 4 % of the game's textures (utility formats such as terrain masks and lookup tables) are
  listed but not opened.

More in the guide's [Known limits](docs/GUIDE.md#known-limits).

## Reporting a bug

Say which version (on the welcome card, e.g. `v1.0.0-beta.3 · own decoder`), which browser and
vehicle, and what you did. Copy any red error from <kbd>F12</kbd> ▸ *Console*. For something slow
or jumpy, use *View & scene ▸ Advanced ▸ Record a session*, press <kbd>F9</kbd> when it goes wrong,
and attach the `.json` it saves. The app sends nothing anywhere, so a report holds only what you
put in it.

## For developers

- Edit `src/`; `npm run build` writes `wt_skin_studio.html`, and `npm run dev` rebuilds on save.
  The build is a concatenation with no dependencies, so there is nothing to install.
- `npm test` runs the offline suite without a game install. `npm run test:list` says what each test
  covers, and `npm run test:all` adds the sweeps that read a real install.
- The page reads the game's Oodle-compressed packs with its own decoder,
  [`src/codecs/wtlz.js`](src/codecs/wtlz.js), written clean-room and byte-exact on every compressed
  payload in a full install. Never publish a build carrying RAD's Oodle blob:
  `tools/t46_wtlz.mjs` checks on every run that the default build holds neither RAD's nor ooz's
  bytes.

## Licence

[GPL-3](LICENSE). Contributions are accepted with a line in the pull request granting the author
the right to relicense them, which keeps a later change of licence possible. Inside the page:
three.js r128, JSZip 3.10.1 and pako, all MIT (their notices head `wt_skin_studio.html`), and
Meta's zstd decoder, BSD-3/GPL-2.

**A promise:** this repository builds the complete editor. If supporters ever get builds early,
those may arrive sooner and carry more, but will never be correct where this one is wrong.

---

<sub>Made with a lot of human effort and love, and with heavy help from AI. `npm test` is how it is
checked.</sub>
