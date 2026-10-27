# Release notes

The one copy of what each build adds (ROADMAP 5.7). `tools/build.mjs` embeds this file in the page,
which shows the section for its own version as *What's new*; `tools/publish.mjs --commit` writes the
same section out as the GitHub release's notes. A section starts at a line `## v<version>` and runs
to the next one; `###` headings, `-` lists, `**bold**`, `*italic*` and `` `code` `` are what the page
draws, and anything else is shown as plain text. Newest first.

## v1.0.0-beta.3

### What's new

- **Check for updates.** Click the version on the welcome card or in the status bar: *What's new*
  shows what this build adds, and *Check for updates* asks GitHub for the list of releases and shows
  what every newer build adds before you download anything. Nothing is sent unless you click, and
  nothing about you is sent then.
- **The 3-D brush paints what is under the ring.** A stroke on the model covers what the camera sees
  under the ring, so it runs across part lines and UV seams without a step or a cut, stops at a
  wing's edge, and leaves a hidden part clean. It is on by default and works with every tool except
  Clone and Retouch; *More brush options ▸ Projected 3-D brush* switches it off for the old behaviour.
- **Export is one click.** The top bar's *Export* writes the skin into `UserSkins` straight away with
  the settings as they stand, and the gear beside it opens the Export window, which keeps *Download
  .zip* and *Save project*. In Firefox, which cannot write into folders, *Export* downloads the zip,
  and the window says so before you click, with the *Extract here* step spelled out.
- **Mipmaps are off by default.** A mipmapped skin can look blurry in the game when seen at an angle,
  and mipmaps only reduce shimmer at a distance; the game accepts a skin either way. A tick saved by
  an earlier build counts as the old default and is cleared; tick *Advanced export ▸ Mipmaps* again
  if you want them.

### Painting

- **Facing limit.** A new slider under *More brush options* sets how steep a surface the 3-D brush
  still paints (85° unless you change it), and the paint fades in over the last 15° so the edge of a
  curved surface is soft, not cut. Lower it to keep paint off surfaces you see at a glancing angle.
- **A pattern brush that reveals whole cells.** Under *Pattern*, pick *Cells* (hexagons, squares,
  diamonds, triangles or scales) and a stroke on the model lays the pattern a whole cell at a time,
  honeycomb-fashion, lined up from stroke to stroke and across seams. It needs the 3-D view with the
  projected brush on; on the sheet it says so instead of painting plain dabs.
- **Colour along the stroke.** *Colour along*, under *Tip dynamics*, changes the colour as you paint,
  so a holographic rainbow is one stroke instead of one colour-picker nudge per stroke. It has
  presets (*Rainbow*, *Holographic foil*, *Oil slick*, *Pearl*, *Heat tint*), and the shape tool's
  *Stamp along* takes it too.
- **A Retouch brush.** Blur, sharpen, smudge, dodge or burn the colour under the brush, picked in its
  *Retouch* row, with a *Strength* and, for dodge and burn, the *Tones* they move most. It reads the
  texture round each dab, so on the model it paints the way the 2-D view does.
- **Strokes follow the pointer.** Spacing now starts at 15% (Panel line keeps 35%) and every mouse
  sample is read, so a stroke no longer trails the pointer or cuts a fast curve into straight pieces.
  A 35% saved from the old default moves to the new one.
- **Pick a tip by its look.** The small square beside the tip menu opens every tip, your loaded ones
  too, as a grid of pictures, and a sample stroke under the row shows how the brush will lay paint
  before you paint. The brush outline in both views is now the tip's own shape, turned to its angle.
- **Tooltips on setting names.** Hovering a setting's name now shows the same tooltip as its slider.
- **Swatches of paint standards and your own palette.** The *Swatches* row switches the colour chips
  between your recent colours, *My palette* and the FS 595, ANA and RAL Classic standards; hover a
  chip for its code. A chip is a screen approximation of a paint sample, not an exact match.
- **A reference window.** *Reference…* beside the swatches opens a movable window of photos or colour
  charts, and a click on an image takes its colour for the brush. The images stay on your machine and
  go into a project only if you tick *Save with project*, which is off by default.

### Layers, fills and selections

- **Lattice fill.** *Fill* gains *lattice, on the sheet* and *lattice, along the model*: a seamless
  honeycomb, squares, diamonds, triangles or scales, with a fill and a border each in its own colour,
  a border width, a size and an angle. Along the model the cells run on across every seam.
- **Blur, Sharpen and Add noise effects.** Three new effect kinds, live and changeable at any time.
  A hue, saturation, brightness or contrast effect inside a group also no longer thickens
  half-transparent paint, so an old project may look a touch different.
- **The selection marks its edge instead of covering the texture.** On the model and the sheet a
  selection is a blue line just inside its edge with a faint wash, and `H` hides it while it keeps
  confining the brush. The magic wand now takes the soft edge of a marking, so a filled pick leaves
  no ragged ring.

### Decals and paths

- **Dragging a decal leaves no ghost.** While it moves, a decal is drawn lighter and only over the
  part of the texture it covers, then settles exactly where you put it, which keeps a big texture
  smooth.
- **A decal on a posed part lands where the part is.** Aim a projected decal at a lowered flap, a
  gear leg or a turret and it now goes onto the part as you see it, not where it sits at rest.
- **Relief from a decal's own image.** *Generate from the image*, beside *Load…* in a decal's height
  map, makes the relief from the decal itself, which suits lettering, stencils and printed markings;
  *Soften* and *Invert* shape it, and changes to a decal's relief can be undone.
- **Click a path's line to add a point.** The curve keeps its shape. `Delete`, the *Delete point*
  button or `Alt`+click removes a point, and `Delete` no longer reaches the layer while a path is
  being drawn.
- **Smooth curves on the model.** Path curves are smooth by default, and *Angle* and *Bias* make them
  deliberately angular when you want a faceted look.
- **A path is a layer you can reshape.** With *as a layer you can reshape* ticked, which is the
  default, *Fill* and *Stamp along* put the path on a layer of its own that follows every point,
  curve and brush change, one undo step each. A project holding one is saved as a newer version that
  beta.2 refuses rather than lose the path.
- **Move, scale and turn a whole path.** *Move · scale · turn* puts a box round the path: drag inside
  it to move, a corner to scale, the knob to turn (`Shift` for 15° steps). A path layer follows.
- **Path presets.** The *Preset* row saves the path you are editing, with its brush, and *Use* lays
  it on any texture again, scaled to fit.

### Mip levels

- **Show a layer only up close, or only from far.** Right-click a layer or group and choose *Near
  only* (levels 0–2) or *Far only* (level 3 on), then fine-tune it in its *Shows at* row with a soft
  edge. Every tool works per level, so a near look and a far look are simply two groups.
- **Colours and numbers that change with distance.** Right-click a fill or an effect and choose *Vary
  with distance…* to set its colour or value, or an effect's numbers, separately for each level; the
  levels between two you set run smoothly from one to the other.
- **Ready-made level effects.** A texture's ⋮ menu ▸ *level effect…* builds *Holo foil*, *Colour
  flip*, *Distance camouflage* and *Metal flake* out of ordinary layers you can open and change.
- **A level ruler to check the game.** ⋮ ▸ *level ruler* adds a group that colours and numbers every
  level. Export with it, walk away from the vehicle in the game to see which level shows where, and
  delete the group before you export the real skin.
- **An In game preview.** *In game*, bottom right of the 3-D view, shows the skin the way the game
  samples a UserSkin, with only the levels the export writes, at the texture quality, screen and
  distance you pick. The *Mip levels* channel view and the 2-D view's *Level* list show the levels
  themselves.
- **Export writes your levels.** A texture with level content keeps its own mip chain whatever the
  *Mipmaps* tick says, and is written as lossless DDS under the TGA preset. Projects that use levels
  are saved as a newer version that beta.2 refuses, and hand-made levels are for UserSkins only:
  Gaijin's tool regenerates the levels of a Market skin.

### Export and files

- **The Export window stays out of the way.** It closes by itself when an export finishes, when you
  click either view and when you start a tool from the keyboard, and stays open after a failed or
  cancelled export so you can read why. Its explanations are one line each, with the full text in
  the tooltip.
- **Replace cleans up after itself.** When *Replace* writes over an existing skin folder it also
  removes the `.blk` and texture files in it that this export did not write, so an old export's
  leftovers cannot outlive their vehicle. The dialog says so first, and *Save as new* removes nothing.
- **Export one texture on its own.** A slot's ⋮ menu ▸ *export texture…* writes the albedo or the
  `_n` as the skin export writes it, as a PNG or TGA image, or as the game's original, and each
  game-file search row has *save* beside *add* and *→slot*. A PNG keeps all four channels of an `_n`.
- **A Market-ready package.** *Zip for WT Live* writes one archive per vehicle with only its `.blk`
  and textures, named in plain letters and digits, and lists what only you can confirm before you
  upload. The camera button's *Market preview — 1920 × 1080 (16:9)…* frames the picture the market
  shows.
- **Check your camouflage scale.** For your own camouflage pattern on a ground or naval vehicle,
  *Scale check ▸ Calibration grid* fills the tile with a numbered grid whose red frame is one repeat,
  and says how long one repeat is on the loaded model and how many fit along its hull. *Remove grid*
  puts the pattern back.
- **A skin's own jet flame.** On a jet, the *jet flame* row in the slot list now shows your painted or
  loaded flame sheet on the model when *Jet flames & gun flashes* is on. It stays out of the export
  until you tick it through its ⊘ mark, because WT Live refuses it, and it is always written as DXT5.

### Game files and vehicles

- **An install split across drives.** If you moved parts of War Thunder to another drive and left
  folder links behind, the app now asks for the folder the links point at, reads the two as one
  install and remembers it. *Advanced ▸ Add linked folder…* adds one by hand, and *Forget folder &
  cache* forgets it.
- **Cockpit view fixes.** The cockpit now loads its own textures, many of which used to come up as
  blank placeholders. A second canopy that hid the whole F-16A cockpit is see-through, and a skin's
  oversized canopy sheet no longer locks the page on loading: it is held at 8192 px, and the status
  line says so.

### Fixes

- **Normal-map relief now reaches the game the right way round.** The two slope bytes of an `_n`
  sheet were swapped (stock sheets were unharmed, because import and export swapped alike), so decal
  relief and anything painted on the normal channel came out turned across the diagonal in the game,
  and the 3-D view lit it upside down. Re-export skins that carry relief to get the fix. An older
  project with an edited normal sheet is converted on opening.
- **Decals land where they point after a resize to 8192.** The known issue from beta.2 is fixed: big
  sheets used to shift every decal until the page was reloaded, and are now projected in pieces.
- **Putting a stroke down no longer freezes the page.** Letting go of a stroke, even a single click,
  used to pause the app while undo read the texture back, and the pause grew with the texture's size.
- **Project files load more carefully.** A project from a newer build is refused before any of it is
  applied, one missing image costs only that image and the status line names it, and every remaining
  field a crafted `.wtproj` could use to put markup into a panel is now forced to its shape.
- **A damaged or crafted file can no longer hang the app.** A broken texture or game file now fails
  with a message instead of freezing the page.
- **A link dragged out of a web page is no longer fetched.** The status line says so and tells you
  to copy the image and press `Ctrl+V`, or save it and drop the file.
- **Unexpected errors reach you.** An error nothing caught now shows on the status bar as *Unexpected
  error at src/…*, naming the file and line; click the bar for *Messages* and *Copy*.
- **Fewer leftover browser-storage connections.** Saving brush tips, path presets, decals, fonts and
  the remembered folder no longer leaves a connection open each time for as long as the tab lives.

### Known issue

- A very long stroke with the 3-D brush can take a few seconds to finish when you let go. 8192 px is
  better than in beta.2 but has not been re-measured over a long session, so 4096 px or below is
  still the comfortable size.

### Install

Download `wt_skin_studio.html` below and open it in Chrome or Edge. Nothing to install, and it
works offline.

## v1.0.0-beta.2

### What's new

- **Decals are easier to place.** A new decal lands straight on the model, in the middle of the
  view, as one undo step. *On the model / On the texture* switches a decal between projected and
  flat in place, keeping its size and rotation. Drag a decal directly in either view, with no move
  mode, and it holds the point you grabbed. A click on the model only picks up a decal inside its
  own frame.
- **Safer project files.** Opening a crafted `.wtproj` can no longer put markup into a panel.
- The brush panel keeps the tool in your hand when the selected layer can't take it.

### Known issue

- Raising a texture to 8192 px can make decals land offset and the app stall. Stay at 4096 or
  below for now.

### Install

Download `wt_skin_studio.html` below and open it in Chrome or Edge. Nothing to install, and it
works offline.

## v1.0.0-beta.1

The first public build.
