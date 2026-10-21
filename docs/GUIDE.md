# WT Skin Studio — user guide (1.0.0-beta.2)

This guide describes the build whose welcome card reads `v1.0.0-beta.2`. What each earlier, internal
build added is kept at the end, under *History*.

## Quick start

Open `wt_skin_studio.html` in **Chrome or Edge** — a double-click is enough. It needs no install and
no connection, and nothing you open or paint is uploaded. (Another browser can still read the install
through its file chooser and export a `.zip`, but cannot open a folder for writing or remember one.)

1. **Open War Thunder folder** on the welcome card. The first visit indexes the install; later visits
   restore that index in about a third of a second and reopen the folder by themselves — at most the
   browser wants one click on **Reopen War Thunder folder**. A folder picked *above* the install (the
   Steam library, `steamapps`, `common`, a drive) finds War Thunder in the usual places inside it.
   **Installed under `C:\Program Files` (any default Steam install)?** Chrome's folder picker refuses
   it as a system folder. Press **Open it another way…** — on the welcome card once the picker has been
   refused, and under the sidebar's open button always. It is the browser's ordinary file chooser,
   which has no such rule: pick the *War Thunder* folder, the browser lists its files first (a few
   seconds, and it may ask whether to "upload" them — nothing is sent anywhere), and the scan runs as
   usual. Such a folder is read-only and is picked again on each visit; the stored index is kept, so
   the second visit is quick. *Dropping* the folder on the window does not work when the app is opened
   by double-clicking the `.html` file *(measured 2026-08-05: on a `file://` page Chrome cannot read a
   dropped folder's contents at all; `readEntries()` rejects with `EncodingError`. On `http://` it
   works normally)*, and a junction no longer helps: Chrome resolves it since ~v128.
   *No install to hand?* Drop a vehicle `.obj` and its `.dds` textures anywhere in the window — the
   manual path always works. A skin you already have opens with **Load a skin…** (a UserSkins
   folder or a `.zip`).
2. **Search a vehicle** by its real name — "Abrams", "F-4E", "T-34" — and click it. Its model and
   textures load straight from the game.
3. **Pick a texture slot and paint.** `B` turns painting on in both views. Add layers with
   **+ Layer**, **Img**, **Text** or **Group** at the top of the Layers panel; every brush writes to a
   layer, and makes one if there is none.
4. **Export as… ▸ To War Thunder** (the foot of the Export window), then press *Update custom
   camouflage list* in the hangar. It writes `UserSkins/<name>/` into the install. Where the browser
   cannot write there — an install under `Program Files`, opened another way — it says so before
   encoding anything and offers **Download .zip** instead, with *Choose UserSkins folder…* beside it
   for an install that is somewhere else. **Download .zip** works everywhere. The zip holds one folder,
   `<name>/`: extract it *into* `War Thunder/UserSkins/`, so that the `.blk` lands in
   `UserSkins/<name>/` — Windows' *Extract All* proposes a folder named after the zip, which nests it
   one level too deep — and Windows asks for administrator approval to write under `Program Files`.
5. **`Ctrl+S`** saves the self-contained project, a `.wtproj`: model, textures and every edit.

**Where your files go.** Inside your War Thunder folder the app writes only `UserSkins/<name>/`, and
only when you press *To War Thunder*. Everything else it makes — a `.wtproj`, a `.zip`, an OBJ, an
exported layer, your settings, a session recording — goes wherever your browser saves downloads.
Reopen a `.wtproj` with **Add files…** or by dragging it onto the window. The recovery copy and the
index of your install stay in the browser's own storage on this machine.

**Reporting a bug.** Say which version (on the welcome card), which browser and which vehicle, and
what you did. `F12` ▸ *Console* shows any error in red — copy it. For something slow or jumpy, *View &
scene ▸ Advanced ▸ Record a session*, press `F9` the moment it goes wrong, then stop and attach the
`.json` it saves. The app sends nothing anywhere, so a report holds exactly what you put in it.

Press `?` in the app for every control; `Esc` closes it.

**Any slider's value can be typed.** Click the number beside it (or press `Enter` on the slider),
type, `Enter`. It is typed in the units the number shows — `1,5` works as well as `1.5` — and
anything past the slider's ends is held to them. `Esc` leaves it as it was; clicking away keeps what
you typed.

## Camera

Left-drag orbits around the grabbed point (raycast pivot). Right/middle-drag pans, wheel zooms. View… dropdown: reset/frame, front, back, left, right, top, bottom, isometric, **Pilot's seat**. `F` enters fly mode: WASD moves, Q/E down/up, Shift ×4 speed, left-drag looks, wheel adjusts speed, `F` exits back to orbit.

**Pilot's seat** puts the camera at the pilot's eye — the position the game itself uses, read from the vehicle's own data (`cockpit/headPos`) — looking down the nose, in fly mode at a walking pace so a drag looks around the cockpit. A vehicle with more than one seat cycles through them. It needs the vehicle loaded from the game files; a project restored without the game folder says so.

## Exterior / Cockpit

Almost every aircraft in the game has a second model beside its exterior: the high-detail cockpit you sit in when you switch to first person. The **Exterior / Cockpit** select in the 3-D view's bar switches between them. It is the same vehicle — one `.blk`, one skin, one texture list — so nothing you painted on the exterior is touched by the switch, and the parts of the airframe you can see from the seat (wings, nose, pylons) are on the exterior's own sheet: a stroke on the wing from inside lands on `f_4e_c` like any other. The cockpit's own sheets (the panel, the gauges, the seat) appear as further texture slots the first time you open it; they are **cockpit sheets**, so in Export they start unticked behind the protected mark — WT Live does not accept modified cockpits, and a personal skin can carry them once you open the gate. Each body keeps its own part list, selection and hidden parts. Stores hang on the exterior only (the cockpit model carries its own pylons and pods). Drones, catapult floatplanes and the zeppelin have no cockpit model, and the select says so. A project saves both bodies and which one was on screen.

**Carrying the cockpit out.** From outside, the exterior shows a low-detail copy of the cockpit — the tub, the seat, the frames you see through the canopy — and on many aircraft that copy is painted by a sheet of its own (`f_4c_interior_c` on the F-4E) that the first-person cockpit does not use, so what you paint in the cockpit does not show from outside. To carry it across: paint the cockpit body, open it once if you have not, then select the exterior's interior sheet, select a paint or fill layer on it (add one if it has none) and choose **model…** in its Mask row, then **From the cockpit**. Every texel of the sheet takes the colour the cockpit body has at the nearest point of its surface — glass, effects and hidden parts lend nothing, so hide a part on the cockpit body to keep it out. It is worked out in the background, with a progress bar you can cancel. **Reach** says how far from the sheet to look: 5 cm to start; shorter keeps only the surfaces the two models agree on, longer fills more of the sheet with colour from further away. It costs nothing to change, and the preview and the line under it follow it. **Add as layer** puts the result in a new layer on top of that sheet and leaves the mask you started from alone; delete the layer to take it back. Judge it from the **Pilot's seat** on the Exterior body. On many aircraft the cockpit body also paints part of the exterior's interior sheet itself; what you paint there already shows from both, so those texels are left exactly as they are and only the rest is carried. Where the cockpit uses the whole of it — the B-17s, for one — the dialog says there is nothing to carry. Closing the dialog stops a bake that is still running.

## Weapons

The **Weapons** tab reads the vehicle's own file out of the game and shows its hardpoints in a row, laid out the way the game's loadout screen lays them: the aircraft seen from the front, so the **right wing is on the left**. Where each chip sits comes from where that station actually is on the model, not from its name. A chip shows what the hardpoint carries and how many; click one to see what it can take — grouped under the game's own headings, each line the store's name with its ammo and mass — pick, and it hangs on the aircraft there and then, that station alone; there is no Apply step, as there is none in the game. A build can be named and kept. Opening the tab moves the camera to the loadout screen's own view — from the front and a little below, at a distance that fits the aircraft — and **Look** repeats that after you have orbited away. Guns and countermeasures are not hardpoints and sit below the row.

## Layers & masks

**A layer is a container, not a type.** One **+ Layer** button makes one; what it *holds* is chosen
afterwards, per channel, in the **channel strip** on the selected layer. Five chips — Colour,
Smoothness, Metalness, Normal, Paint mask — show which channels this layer carries and what is in
each (paint, a flat fill, or an effect). Click a chip to work in that channel; click a `+` chip to
give the layer that channel; the small arrow converts the content to another kind, moves it to
another channel, or removes it. The layer rows in the stack show the same thing as coloured dots.

You do not have to use the strip at all: pick a tool, paint, and the channel it writes lands in the
selected layer whether or not that layer had one — the brush makes the slot. Blend modes, opacity,
masks and part limits belong to the whole layer and apply to every channel in it. Everything stays
non-destructive until export.

**Groups are folders and the list draws them as folders**: a folder glyph, a preview of what the
group composites to, and a guide line down its children. **Drag onto the middle of a row to put a
layer inside** — inside a group, or, on an ordinary layer, into a new group made of the two (the
dragged one lands on top); the row lights up to say so. Drag to a row's edge to reorder; a line
shows where. Every list ends in a drop strip that appears while you drag — that is how a layer goes
to the very bottom, or out of a group that sits last in the stack.

**Any layer, group or decal can be written out as its own image** — right-click it, *Export as
image…*. Where the two differ you are asked which: **own pixels** (a paint layer's canvas as you made
it, a decal's source image at its own size, a group's layers flattened) or **on the sheet** (the same
thing placed at sheet size, through opacity, mask, part limit and blend — the one to take into
another editor and paint over, and the only form that carries a projected decal's wrap). PNG by
default; TGA if you want it. A decal with a height map writes that beside it.

**A selected decal shows on the model** as a ring round its footprint — its edge, how far its depth
reached, how it is turned. Click a decal in 3-D to select it; click beside it, or on nothing, to let
go. A **projected** decal also carries **handles**, in the 3-D view and on the sheet in the 2-D view
alike: drag a square corner to resize it and the round knob above it to turn it (Shift turns in 15°
steps), each one Ctrl+Z. A line from its centre shows which way it is aimed and how deep it reaches —
after an orbit, the one sign that it is still aimed from the view you placed it in. The handles hide
while painting is on or another placing mode is waiting for its click, and on a decal too small on
screen to have room for them. On the sheet they also stand down while Select or the shape tool has
the 2-D view, or the brush is set to paint a mask — the frame stays, so you can see where the decal
is, and a press there does what that tool does.
Like every slider's value, the angle can be typed. **Square to the texture** turns a projected
decal so its edges follow the texel rows of the UV shell under its centre — a marking laid at 3° on
a 2048 sheet has a staircase no anti-aliasing hides — and for a decal placed on the sheet, *Square
to the texel grid* is the nearest right angle.

**Screenshot** — the camera button in the top bar, next to *View* — writes the 3-D view as it is framed now at
up to four times its size, over a transparent background with a soft shadow under the vehicle — for
a promo page or a forum post, dropped straight onto another image. It is the app's own shading, not
the game's; a good angle and the 4× size do most of the work.

**Masks.** Any paint, image or fill layer can carry one: a sheet whose brightness decides how much of the layer shows — white shows, black hides, grey partly shows — and nothing is deleted, so removing the mask brings the layer back whole. Ways in: **+ white** (then hide where you paint), **+ black** (then reveal where you paint), **from selected parts**, **image…** (a stencil, a grunge map, a hand-drawn shape; its own alpha counts too, so a transparent PNG background hides), or **layer…** — another layer's painted pixels, live: paint on that layer and this one follows, the way an anchor point works in Substance. A referenced mask shows the source's name; *→ painted copy* freezes it into a mask of its own when you want to edit it or delete the source. **clip ↓** is the same thing pointed at whatever sits directly below in the stack — a clipping mask, which follows when either layer is moved. **model…** bakes one from the model itself: its **curvature** (where the surface bends — *edges* for chipped paint and bare metal, *cavities* for the grime in fillets and panel joints; the mesh's own creases plus the normal map's panel lines and rivets) or its **occlusion** (how enclosed each point is — under the wings, in the wells, between hull and fenders; *occluded* for dirt, *open* for fading). Each has a levels pair (*from* / *to*) and a soften, previewed live over the sheet's own colour; the bake is done once per texture and the levels are free after that. Whatever is hidden on the model casts no shadow, so hide a gear door to bake the bay open. On an aircraft the same dialog has a third entry, **From the cockpit**, which is not a mask at all — it adds a layer carrying the first-person cockpit's paint onto the exterior's own (see *Exterior / Cockpit*). **noise…** puts a hidden noise layer directly under this one and masks this one by it, in one undo step — select the noise layer to change its kind, scale, seed and levels (see *Noise and patterns* below). Once it exists: **paint it** with the Mask brush (paint hides, Alt or value ≥ 128 reveals; hidden areas tint red while the tool is active), **invert**, **soften** into a fade, **show all** / **hide all**, or replace it from another image. Every one of those is a single undo step. The mask has its own thumbnail beside the layer's content in the stack — click it to start painting on it — and it works on every channel, not just colour.

**Blend if.** Beside the mask, a layer can be shown by *what lies beneath it*: only where the sheet below is dark, or light, or in a band between (*From* / *To*, with a *Soften* ramp at each end and an *invert*), or only where it is near a colour you pick (*Match* is how close). Weathering that follows the panel lines already in the game's albedo starts here — a grime layer set to show where the tone beneath is under 35 % lands in every seam and nowhere else. It combines with the mask: both have to let a texel through. On a group it applies to the group's flattened result, read off the sheet beneath the group.

**A control you can see is a control that works.** A slider only appears when the vehicle's own animation actually moves that part: measured across the roster, a third of the controls the app used to offer moved nothing at all — wing sweep on aircraft with fixed wings, and the elevator and rudder of most jets, whose deflection the game computes from the flight model rather than storing as an animation. Those parts are still posable, from a hinge worked out from their own shape, which is why some labels are dimmed.

**Posing a tank.** The turret and gun sliders now come from the vehicle's own datasheet: a Tiger elevates −8° to +16°, an ISU-152 traverses −3° to +7° rather than all the way round, and the gun's depression follows the hull — drag the turret over the engine deck and the gun rises to the few degrees it really has there, which is what the game does. The turret carries the gun and the barrel with it. Hatches are no longer offered on ground vehicles: a player cannot open one in game, so the slider was a mode the vehicle does not have (a vehicle whose own animation keys a hatch — an aircraft's bomb bay — still has it).

**Radial symmetry.** Beside *Symmetry* in the brush panel, **Radial** turns one stroke into a ring of copies: a bolt circle on a road wheel, the rivets round a hatch, the blades of a spinner. Set the count, press **Set centre…**, then click the hub — that point is the centre the copies turn about, and the axis is that surface's own normal (the axle of a wheel face, the up of a turret ring); name **X / Y / Z** instead when the face you can reach is slanted. A copy is a real stroke on the real surface, so where the shape is not actually symmetric the copy simply lands nowhere. It works with Symmetry: both on, each copy is mirrored too, and on a wheel — where the mirror plane's normal is the axle — the two wheels' rings come out as each other's mirror image. A ring costs no more raycasts than a plain stroke: the copies are paid for with a slightly coarser walk of the same pointer move. The blue rod shows where the axis is, and follows the **Mirror plane** setting. The centre belongs to the vehicle it was picked on, so it is not carried between sessions or models; the count and the axis are. (To nudge the *mirror* plane itself — a model that is not centred — use *Axis offset* under **More brush options**.)

**Gradients.** A fill layer is a flat colour or a gradient — the *Fill* select on the layer panel: **gradient on the sheet** (an *Angle*; a Limit rectangle you drew centres it, and *From* / *To* are fractions of the rectangle's reach), **radial on the sheet**, or **gradient along the model** — read off where each texel sits on the vehicle, so a fade from the nose back is one setting (*Along*: nose → tail, top → bottom, port → starboard and their reverses, or a *Yaw* / *Pitch* of your own) and meets itself where two textures join. *From* / *To* there are fractions of the vehicle's length along that direction, or of the layer's parts when it is limited to some: limit a layer to the left wing, choose nose → tail, set To to 25 %, and that is the leading-edge fade. Each **stop** is a colour (a value, on a single-value channel) and an opacity, so a fade to nothing is a stop at 0 %; *+ stop* adds one with the colour the gradient already has there, *reverse* swaps the ends. *Past ends*: hold the end stops, repeat (stripes), or reflect — set From to 50 % and a reflected fade runs out from the centre line to both sides. Along the model the first one on a texture takes a moment to place (a progress bar; once per texture, and only while a gradient along the model is on it); everything after that is immediate. A gradient converts to painted pixels from the channel strip's menu when you want to paint into it — and it works as a **mask**: hide the gradient layer, put the layer you want faded above it and press **clip ↓** (or pick it under **layer…**), and that layer shows where the fade is opaque.

**Noise and patterns.** The same *Fill* select has three more kinds. **Noise, along the model** is grime, mottling, chips and rain marks without anyone's grunge maps: a noise worked out from where each texel sits on the vehicle, so it runs across UV seams without a break and agrees on every texture the vehicle uses. *Noise* picks the look — **Perlin** (soft grime), **value** (blotchy mottling), **cells** (spots and chips) or **streaks** (rain marks running down the vehicle, with a *Stretch*); *Scale* is the size of the largest features in metres (drag, or type metres in the box); *Detail* adds finer layers and *Roughness* says how strongly they show; the same *Seed* is the same noise every time (*new* rolls another). Below those are a gradient's own rows, and they are what shape it: *From* / *To* are levels on the noise — close together is a hard-edged cut, which is how spots come out of a soft field — and the stops colour it, so a stop at 0 % leaves the dark half transparent. **Pattern, on the sheet…** asks for an image (any picture, or a DDS) and repeats it a whole number of times across the sheet, with an *Angle* and an *Offset*; **pattern, along the model…** wraps it round the vehicle from three sides instead (tri-planar), with a *Size* in metres — the same on every texture — and a *Blend* saying how quickly one side's projection hands over to the next where the surface turns. *Angle* turns either kind clockwise and *Offset* slides it along the tile, the same way on the sheet and along the model, so switching between the two keeps the look. A tile that repeats seamlessly hides its own edges; the app does not make it seamless for you. On smoothness, metalness and the paint mask a pattern is its brightness. Both work as masks (**clip ↓**, **layer…**, or *noise…* in the Mask row): a noise by its opacity, as a gradient does, so its stops decide — and a pattern by its brightness, as **image…** reads a picture: white shows, black hides, and a transparent part of the tile hides too. Both convert to painted pixels from the channel strip. **Chipped paint** is a noise and the curvature bake together: a noise fill in the bare-metal colour — *cells*, with From and To close together so it is hard-edged spots and nothing between them — given a *model… ▸ curvature (edges)* mask. The noise decides where a chip is and the mask keeps the chips to the edges; *Blend if* on top of that keeps them off whatever tone you name. Along the model the noise and the tri-planar pattern are worked out in the background: the layer keeps showing its last result while a new setting is worked out, a long one shows the progress bar (with *Cancel*), and an export waits for the setting you left it on.

**Effects.** An effect layer changes what lies beneath it on its channel — live, and changeable any time. Its first row picks the kind: *Hue / saturation / brightness / contrast* (where a new effect starts), **Levels** (*In black* and *In white* squeeze the range, *Gamma* bends the middle — above 1 lifts the midtones — and *Out black* / *Out white* lift or cap the result: the everyday tool for a roughness or metalness map), **Curves** (click in the box to add a point and drag it; drag a point out of the box, or double-click it, to remove it; the dashed line is no change), **Colour balance** (pick shadows, midtones or highlights, then push cyan–red, magenta–green and yellow–blue; *Keep luminosity* changes the colour and not the brightness), **Gradient map** (every tone becomes the colour at its place along the stops — black's at the left end, white's at the right; a stop at 0 % leaves those tones as they were), **Invert**, **Threshold** (black or white by tone, around a level) and **Posterize** (a few flat bands). Picking another kind starts it fresh, and Ctrl+Z takes you back to the settings you had. On the colour channel Levels and Curves have a *Channel* select: red, green and blue can each have their own, applied before the one for all channels. Colour balance and the gradient map are for colour; the rest work on smoothness, metalness, the normal map and the paint mask too. Opacity fades an effect and a mask or a Limit confines it. An effect changes colour, never coverage: inside a group over half-transparent paint, the paint stays exactly as transparent — except with the four-number kind, which for now still makes it more opaque there (use Levels, or put it outside the group).

**A saved stack.** Right-click a group (or a layer) ▸ *Save group as stack…* writes it as a `.wtstack` — the layers, their masks, blend-if bands, decals with their Looks, everything — and *Load a stack here…* (or dropping the file in, or *Add files…*) puts it on the selected texture of any vehicle, above what is there. "My weathering stack" onto the next vehicle. What cannot carry over is adapted and said in the status line: canvases are resampled to the new sheet, a projected decal is kept as its painted pixels (its projection frame belonged to the vehicle it was made on), part limits keep only the part names this model has, and a link across textures is dropped.

**Into Photoshop, Paint.NET, Krita or GIMP, and back — PSD and OpenRaster.** Right-click any layer ▸
*Export all layers for another editor (.ora / .psd)…* — or the texture's ⋮ ▸ *export layers…* — and
pick the kind: **Photoshop (.psd)** opens in Photoshop, Paint.NET, GIMP, Krita and Photopea;
**OpenRaster (.ora)** in Krita, GIMP and MyPaint. Either writes the texture's whole stack as one
file: a layer per layer, groups as groups, the base sheet at the bottom, so the other editor opens it
looking like the texture. Opacity, visibility and blend modes stay live. What the file cannot hold
goes into the pixels instead: a layer's mask, clip, part limit or blend-if is applied to that layer;
a group with a mask or limit of its own becomes one layer, and so does a group with a Levels, Curves
or another of the adjustment kinds inside it; an effect is written as what it does to the layers
under it, so it will not follow edits you make below it there; a decal, a projection, a pattern or
text is what it draws on the sheet. The status line lists each of those. One file holds one
channel — with layers on more than one, you are asked which. Soft light is Photoshop's own curve
there, so a soft-light layer looks a little different in Photoshop; the status line says so. It also
names a Linear Dodge (Add) layer brought in from another editor and left below full opacity:
Photoshop fades such a layer after adding it, where this app fades it as it adds, so it looks darker
there wherever the sum passes white.

The other way: drop a `.psd`, `.psb` or `.ora` in (or *Add files…*, or ⋮ ▸ *import layers…*). Its
layers arrive as paint layers in one group named after the file, on the selected texture, on the
channel the brush is in, keeping names, opacity, visibility, blend modes and groups — a pass-through
group stays one. From a PSD, a layer's or a group's mask comes in as its mask (one set to *Hide All*
hides it, as in Photoshop), a clipped layer or
group as masked by the layer it clips to (a clipping stack on a base that is not plain Normal at full
opacity and fill, or
that has a mask, comes in as a group with the base's blend, opacity and mask, which is how Photoshop
draws it), and fill opacity is kept. A file
painted at another size is resampled to the sheet. A layer whose blend has no equivalent here — an
eraser layer, Linear Burn, a Krita-only mode — comes in **hidden** rather than drawn wrong; an
adjustment layer (it has no pixels), a layer that is not a picture (a vector layer in an `.ora`), a
layer's or a group's layer style and Photoshop's Blend If are left out; the status line names each (a
layer's own *Blend if* here can be set to do the same job). A Linear Dodge (Add) layer or group below
full opacity comes in, but looks brighter here than in Photoshop wherever the sum passes white, and
is named too. A 16-bit PSD reads if its layers are
RLE-compressed, which Photoshop mostly does not do at 16 bits — save it as 8 bits per channel first;
a CMYK or 32-bit file is refused, and says so. It is one undo step. A file you exported, edited and
brought back still has its base layer at the bottom, so it covers the older layers under it: hide or
delete those once you are happy with it.

**A selection and a mask go both ways** (v0.22). *Selection → layer mask* puts the whole selection — the rectangle, the UV islands inside it and the parts you have selected, composed exactly the way they confine a brush stroke — onto the active layer as its mask, and leaves the selection alone. *Mask → selection* is the direction that did not exist: the mask's light areas become the selection, as a **shape** rather than the box round it, so a mask you painted, imported or softened becomes something Fill, Clear, Crop and Copy can work with. Both are in the Selection panel, and the mask row has them too.

For "this layer only lives here", prefer the layer's **Limit ▸ ← selection** over a baked mask: it is stored as a recipe — the part names and the rectangle, not pixels — so it survives a texture resize and a reprojection exactly, and you can clear it any time. Bake (**bake selection**) when you then want to soften or hand-paint the edge. A UV island pick can only be baked: an island has no name, only a place, so it is not something a project file can promise to find again.

Working in the stack: drag a layer to reorder, right-click for the layer menu (rename, duplicate, clear, mask, part scope, delete), double-click a name to rename, `Alt`-click an eye to show only that layer, `Ctrl+D` duplicates, `Del` deletes. Each row carries a small preview of what the layer contributes.

**Groups.** `Group`, under the Layers header, puts the selected layer in a group; drag the others in.
Since v0.22 a decal's surface Look does **not** make one: the gloss, metal and raised edge are
channels of the decal's own layer, so they move, fade, hide and delete with it and there is no
folder to fold, unfold or accidentally drag apart. Group a roundel with its serial if you want them
to move together — that is what a group is for.

**Working inside a group.** Selecting the folder is a normal place to be: a decal's controls come
from the decal inside it, so you can move, rotate and re-project without unfolding anything. Picking
a brush while a group (or anything in it) is selected jumps you to the layer that brush writes
to — pick Smoothness and you land on the group's gloss layer. If the group has no layer for that
channel it offers to add one. It will not land you on a decal's *derived* gloss, and painting one by
hand is refused: it is rebuilt from the Look every time the decal moves, so the stroke would not
survive. Duplicate the layer (⧉) for a copy that stays put. Moving a decal moves everything else in
its group with it. A
group carries its own name, visibility, opacity, blend mode, mask and part limit and applies all of
them to **everything inside it** — so a marking whose colour, normal and smoothness maps belong
together moves, fades and masks as one thing. A group is not tied to a channel: its children keep
theirs, and each still lands in its own sheet.

Dragging onto a group row has two targets: the **middle** of the row drops the layer *inside* the
group, the top and bottom edges drop it *beside* — hold `Shift` to force "beside" over a group you
only meant to pass. The triangle folds it. Groups nest. Deleting a group deletes what is in it (one
`Ctrl+Z` brings the whole thing back), and `Ungroup` leaves the layers where the group was — it will
tell you if the group's own opacity, blend or mask could not be carried over, because there is no
longer anything to hold them.

One thing worth knowing: an **adjustment layer inside a group** adjusts that group's content only,
not the layers underneath it. That is what a group does; put the adjustment outside the group to
have it affect everything below.

**Limiting a layer to a few parts.** Select the parts (Parts tab, or `Ctrl`+click in 3D) and press the layer's `Limit ▸ ← selection` — or just add the layer while a selection is live and it inherits it. The limit is non-destructive, stored as part names (so it survives a texture resize, a project reload and a re-projection), names itself after the part group when it matches one, and confines the brush as well as the display. Works on paint, fill, decal and adjustment layers: "green turret over grey hull" needs no hand-painted mask.

## Brushes

Color · Eraser · Clone · Smoothness (R) · Metal (B) · Flatten normal · Panel line (emboss: value <128 carves, >128 raises) · Clone normal · Wear mask · Mask. Size, opacity, **flow**, hardness, and **spacing** (how often stamps land along a stroke — low = dense/smooth, high = dotted). Alt+click picks color, Shift+click draws a straight line from the last point (in either view, however far), `[` `]` / Alt+wheel resize, recent colors become palette chips. **The picker gives you the colour you can see**, which on a ground or naval vehicle is not the same as the colour in the layer: those are drawn as the vehicle's own bare sheet with your paint over it through the coverage mask, exactly as the game does it, so an unpainted area shows the camouflage and not what is underneath. Pick it, paint it back, and the surface comes out the colour you picked; the status line names the layer's own colour too when the two differ.

**Opacity and Flow are two different things.** *Opacity* is the most one stroke can lay down: go
over the same spot twenty times in one stroke and it is still no darker than Opacity. *Flow* is how
much each dab lays down — below 100 % a stroke builds up where it passes over itself, like a spray
can, which is how to shade and weather by hand. Tick **Build up past Opacity** and the ceiling goes:
every dab adds, and a stroke keeps darkening where you go over it, like an airbrush or a marker. Each
tool remembers its own Flow and Build up, so a 20 % weathering brush and a 100 % camouflage brush
stay set up. (Panel line has neither: its strokes always add.) The shape tool's **Fill** lands at
Opacity whatever Flow says — a fill is one dab, with nothing to build on.

**A pen or stylus is pressure-sensitive.** Pressing harder makes each dab bigger (up to Size) — tick
**flow** on the *Pressure* row to have it lay down more paint too (up to Flow), or untick **size** for
a line of even width. Each tool keeps its own choice. How hard you have to press is the **Pressure
curve** under *More brush options*: *Soft* paints most of it at a light touch, *Firm* needs a firm
press. A mouse always paints at the full size and flow. A Shift+click line is laid at the pressure of
the click all along — not tapered up from the light touch the last stroke lifted off with — in both
views.

**Smoothing** steadies a shaky hand: the brush trails the pointer on a string that many screen pixels
long, and does not move until the pointer pulls it. A wobble shorter than the string never reaches
the paint, and a corner comes out rounded. While you paint, the ring shows where the brush end is —
in the 2D view with the string drawn to it, on the model as the ring alone — and it comes back under
the pointer when you let go. The stroke ends where the brush end is, not under the pointer. 0 is off.

**The tip is the shape each dab is laid in.** *Round* is the brush as it always was. *Square*,
*Rivet* (a domed head with a highlight towards the upper left) and *Chip* (a flake of paint with a
ragged edge) are made at the brush's size, so they stay crisp at any size. **Load…** takes any image
as a tip: a shape on a transparent background, dark ink on light paper (how Photoshop and GIMP draw
tips) or light on dark (how Substance's alphas come) — each is read the right way round, and a JPEG's
off-white paper is not mistaken for paint. Transparency is the shape only when a real part of the
picture — a tenth or more — is see-through: a screenshot's rounded corners, one transparent corner or a
thin transparent frame round opaque paper are paper, not ink. Where the picture is darker, more paint lands, so the
rivet's highlight lets the panel show through; the colour is always the brush's own, so one chip tip
paints olive chips, silver chips, or chips on a mask. The little square beside the select shows the
tip as it lays paint. Loaded tips are kept in this browser beside the decal library and travel with
a settings export (see *Settings* below); the remove button beside **Load…** takes one out again, and
every tool that used it goes back to Round. Hardness only shows for Round and Square; the others carry their own edge.

**Tip dynamics** vary each dab from the one before it: **Size jitter** makes dabs up to that much
smaller, **Flow jitter** has each lay up to that much less (the per-dab opacity jitter — the stroke is
still capped at Opacity unless *Build up* is on), **Scatter** throws each dab up to that many of its
own sizes off the stroke, **Angle** turns the tip, **Angle jitter** turns each dab at random (100 is
any angle at all), and **Angle follows the stroke** turns each dab to face the way the stroke is
going — on the model too, where "the way" is the stroke's direction on the sheet. Scattered chips with
size and angle jitter at a low Flow are chipped paint; a Rivet with *Stamp along* is a rivet row. The
first dab of a stroke has no direction yet, so it is laid at Angle alone. Where a stroke on the model
crosses onto another UV island, the first dab there already faces the way the stroke runs on that
island, and so does the first dab of a mirrored copy that jumps to the other side's island. On the
sheet a mirrored copy is turned the reflected way right up to the edge of its island: which way it
runs is read only along the part the stroke is on and along its twin, never across the gap to a
neighbouring part's island, so a row of rivets along a panel's edge mirrors as a row. The tip
and all of these are remembered per tool, like Flow, and Panel line has none of them (its groove is
carved, not stamped).

**The brush outline.** In the 2D view a *Square* is outlined as its square, turned to its Angle; every
other tip is outlined as the circle its Size spans. That circle is the Size, not the dab: a Round, a
Rivet and a Chip lie inside it, but a loaded tip is scaled so that its longer side is the Size, so a
picture whose ink reaches its corners reaches past the circle, by up to half its diagonal. The ring on
the model is that circle for every tip, the Square included — whose corners reach past it the same
way — and its inner ring, where a soft edge stops being opaque, shows only for Round and Square, the
two tips Hardness shapes.

**Clone copies the sheet from somewhere else** — the rivets, panel lines and dirt the game's own
albedo already has, onto where a marking used to be. Alt+click sets the source (a cross in the 2D
view, and it works on the model too); the first stamp of the next stroke fixes the distance between
source and brush, and from then on the source keeps step with the brush — across strokes, until you
Alt+click again — with a dashed ring showing what the next stamp will take. A stroke copies the sheet
as it was when the stroke began, never its own output, so cloning across itself does not smear.
**Match tone** shifts each copy to the tone under the brush, for a rivet taken from a sunlit panel
onto a shaded one; off, the copy is exact. **Clone normal** is the same tool on the normal map,
which is where the rivets and panel lines live post-2022. Both write to a layer of their own, like
every brush.

**Painting is one switch.** The **Painting** button under the brush, the button over either view, or `B` — it covers 2D and 3D together, and picking up a tool turns it on. With it off, a click in 3D picks parts and orbits and a drag in 2D pans. While it is on, a **ring is projected on the surface** under the cursor showing the brush's true size: brush size is authored in texture pixels, which is half a drop tank and a hand's width of fuselage at the same number, so the ring is derived from the hit triangle's texels-per-metre. It is the circle the Size spans whatever the tip — it marks the Size, not the dab: the Round, the Rivet and the Chip lie inside it, while a Square's corners, and those of a loaded picture whose ink reaches them, lie outside — and its inner ring, where a soft brush stops being opaque, shows only for Round and Square.

**Across UV seams.** Painting over an island border used to leave pale straight lines along it, or spray onto an unrelated part of the sheet. The stroke is now continued from the geometry: each triangle's texel density says how far a stamp should have moved on the sheet, so a genuine seam crossing is recognised and never bridged, and the pointer's travel is subdivided in screen space with a raycast per sub-step, so both sides of the seam are filled with real surface hits.

**A layer owns one channel, and the tools follow it.** With a Metalness layer selected the colour brush is switched off and says which channel you are in — a layer that declares a channel only ever writes that channel, so a "Metalness fill" no longer paints the vehicle in the colour picked for it, and it no longer offers a colour to pick: a fill on a single-value channel takes a value slider. Only the options a tool actually uses are shown. Click the selected layer again to deselect it and go back to painting the base texture.

**The shape tool.** **Shape: off / on** in the right-hand panel turns the 2-D view into a pen: click to place points, drag as you click to curve the one you just placed, **Ctrl+drag** a point to curve it later, **Alt+click** one to take it out, **Backspace** to drop the last, and click the first point again to close the path. **Esc** throws it away. Then any of three verbs — they are the same path:

- **Fill** paints the closed shape on the layer you are painting, in the brush's own colour (or value, on a single-value channel) and opacity — in **one** fill, so the edge is clean rather than the pale seam that two overlapping fills leave. A hard-edged disruptive camouflage is about six clicks.
- **Stamp along** walks the brush you are holding down the path at its own **Spacing**: rivets round a hatch, a panel line that follows a curve, a dotted wear line. It works with every tool and every channel, so *Panel line* stamped along a path carves the groove and *Clone normal* copies rivets onto the normal map. It lays the brush's tip, and with *Angle follows the stroke* each stamp is turned to the path — a row of square rivets round a curve stays square to it, and so does its mirrored copy.

- **→ selection** makes the closed path a selection instead of paint — exactly the texels its Fill would paint — so the brush, Fill, Clear, Crop and Copy then work inside it. Shift+click adds it to what is already selected, Alt+click takes it away (see *Selecting part of a sheet*).

Fill and Stamp along land where the brush would have painted — the selected layer's content on the brush's channel, or its mask — and each of the three is one undo step. The path stays until you clear it, so you can fill it, change the colour, stamp along and select the same shape.

**On the model.** With the shape tool on, the same clicks work in the 3-D view: a click **on the model** places a point on the surface, and a click **off it** — or any right or middle drag — still orbits and pans, so you can keep turning the vehicle while you draw. The path is drawn over the model and follows the camera. It is aimed the way the view faced when you placed its **first** point: **Fill** projects the shape back along that direction, the way *Project onto model* projects a decal, so a blotch drawn across a UV seam fills both sides of it — which a path on the sheet cannot, because the two sides of a seam can be anywhere on the texture. The projection stops at the first surface it meets and does not reach far past the depth your points were placed at, so it does not come through to the other side of a wing or onto a surface below. Its edge is hard: each texel is filled or not. **Stamp along** puts each stamp on the surface under the path, with *Symmetry* and radial copies as for a brush stroke, and **→ selection** selects what Fill would paint on the active texture. Line the view up before the first point the way you want the shape to fall; orbiting afterwards does not change what it paints. Both verbs write the texture you are painting, like the 3-D brush. A path belongs to the view it was started in — clicking in the other view says so, and **Esc** clears it.

## Selecting part of a sheet

**There are two grains of selection, and the Selection panel is one row for each.** *Parts* are
picked on the model — `Ctrl`+click a part in 3-D, or click names in the Parts tab — and the brush
paints only those. *Area* is marked on the sheet: a rectangle, whole UV islands, a lasso's outline,
a colour taken with the magic wand, or a closed shape-tool path. Each row ends with the bridge to
the other grain (*→ islands*, *→ parts*). Under them, **All / None / Invert act on whichever grain
is live** — the area while Select is on, the parts otherwise — and the label in that row says which.
The modifiers mean the same thing everywhere: **Shift adds, Alt removes** — in the Parts list, on a
marquee, on an island, with the lasso, the wand and a path, and across them: Shift+click an island
while a lasso's outline is selected and both are. Shutting a part out of painting is the shield in
the Parts tab or `Ctrl`+right-click on the model, never a modifier. While `Ctrl` is down over the
model the cursor is a hand (a cell when Islands or the Wand is on) and the status line names what a
click will do, so the quick pick you can make while painting is visible before you make it.

**Select** (the button over the 2D view, the one in the Selection panel, or `M`) turns a drag in the
2D view into a rectangle instead of a stroke. It has eight handles, a dimmed outside, an aspect lock
and typed X / Y / W / H numbers, and it is always **whole texture pixels** — a half-texel rectangle
would resample the layer for nothing. **Shift+drag adds** a rectangle to what is selected and
**Alt+drag takes one away**; until you let go it is only a dashed outline (the accent colour to add,
red to take away), so nothing is recomputed while you drag.

A selection is not just a shape you drew. **The brush is confined to it, in both views**, so it stays
in force after you switch Select back off; `Esc` clears it, `Ctrl+A` takes the whole sheet. It belongs
to one texture — moving to another slot leaves it behind — and resizing the sheet under it clips it to
what is left rather than pointing at texels that no longer exist.

Four verbs act on it, all on the active layer and all one undo step:

- **Fill** — the brush's own colour (or value, on a surface channel) at its opacity. It respects the
  part selection, protected parts and the layer's part limit, exactly as a stroke would, and it
  creates a layer for the current tool if there isn't one, exactly as the first stroke would.
- **Clear** — erase inside the rectangle.
- **Crop layer to selection** — erase everything outside it. This is the crop tool, and it is one verb
  on the selection rather than a mode of its own.
- **Copy to image layer** — the selected texels become an image layer sitting exactly where they were
  taken from, at scale 1, which you can then drag, rotate, mirror or project onto the model.

Clear and Crop deliberately ignore protected parts: they only ever take away pixels the layer already
owns, and a crop that left something outside the rectangle would not be a crop.

### Selecting a UV island

**UV island** (the button in the Selection panel, or `K`) makes the same tool select *shells* instead
of boxes. With it on, a **click** takes the UV island under the pointer — in the 2D view, or
`Ctrl`+click on the model — and a drag still makes a rectangle, so the two live in one mode. Shift+click
adds an island, Alt+click takes one back out, and a click on the gutter between the shells clears the
selection.

An island is finer than a part in both directions, which is the point: one part is usually several
shells (a hull's deck, its sides, its skirts), and one shell is often shared by several parts. So this
is the way to say "this panel" when the model does not have a part for it. All five things a selection
does — confining the brush, Fill, Clear, Crop and Copy — follow the **island itself**, not the box
around it; the box is only what the X / Y / W / H numbers report.

Two things worth knowing before the first click. **A mirrored shell is one island and both sides of
the vehicle** — that is genuinely the same texels, so painting it paints both, and the status line says
how many parts the island spans so it is not a surprise. And an island selection **is not saved in the
project**: an island has no name, only a place, so it is a selection rather than a per-layer limit.
Bake it into a mask, or use a layer's part limit, if you need it to survive a reload.

**The selection shows on the model, not only on the sheet.** Whatever is selected — a rectangle, a
set of islands, or a lasso's, a wand's or a path's shape — is tinted on the vehicle in the 3D view,
because a selection confines the brush in *both* views and a viewport that showed none while half
your strokes were refused was the worst kind of hidden mode. Press `V` to draw the UV island outlines
over the sheet as well, so you can see the shells before you click one.

### The lasso, the magic wand and a path

These three make a selection of any shape, the way the patches of a camouflage are picked out in
Photoshop. Each is one undo step, and what it makes behaves like an island pick: the brush, Fill,
Clear, Crop and Copy follow the **shape**, not the box round it, and the panel says "a shape is
selected". Fill, Clear and Crop change whole texels only — on a smoothness, metalness or normal
layer too, which is usually half the colour sheet's size — so two patches recoloured one after the
other meet with no gap and no overlap. A shape has no handles — drag a rectangle to start again — and it is not saved in the
project; *→ layer mask* keeps one.

- **Lasso** (`L`, or *Lasso* in the Selection panel). **Drag** round an area for a freehand outline;
  it closes when you let go. Or **click** corner by corner for straight edges and close it on the
  first corner (the corner lights up when a click there will close it), with a double-click, or with
  `Enter`. `Backspace` takes back the last corner and `Esc` drops the outline without touching the
  selection under it. Hold Shift at the first press to add the outline to what is selected, Alt to
  take it away.
- **Magic wand** (`W`, or *Wand*). Click a colour on the sheet — or `Ctrl`+click it on the model — and
  everything within **Tolerance** of it is selected. Tolerance is the largest difference allowed in
  any one of red, green, blue and alpha, 0–255; 0 takes exactly that colour. With **Contiguous** on
  (the default) only the patch you clicked is taken, joined edge to edge, so two blotches that touch
  at a single corner stay two; with it off every texel of that colour anywhere on the sheet is taken,
  which is Photoshop's *Colour Range*. The wand reads the sheet the 2-D view is showing: the finished
  colour normally, or the smoothness, metalness or normal sheet when the brush in hand paints that
  channel or a channel view shows it, so a patch of gloss is picked by its gloss. On a ground or naval
  vehicle with the camouflage preview on it takes the colours you see — the camouflage where the
  paint covers, the vehicle's own sheet where it does not — the same ones the colour picker takes. The status line names the colour it took and how many texels.
  A click on a big sheet takes a moment, because it reads every texel of it; if it is still reading
  after a fifth of a second a progress bar says so, with *Cancel*.
  Shift+click adds another patch and Alt+click takes one away — every blotch of one camouflage colour
  in a few clicks. A drag with the wand still makes a rectangle.
- **A path.** In the Shape tool, **→ selection** turns the closed path into a selection covering
  exactly what its Fill would paint (see *The shape tool* under Brushes).

Only one of Islands, Lasso and Wand is on at a time; pressing a kind's key again goes back to the plain
rectangle. Turning the Lasso or the Wand off keeps what it made, the way a stroke outlives the brush —
*None* or `Esc` clears it. (Turning **Islands** off still releases an island pick, as it always has.)
An outline half drawn belongs to its texture, like the selection: switching to another slot drops it.

### Parts and islands are two grains of the same question

Both answer "where does this apply", one per mesh piece and one per UV shell, and the Selection panel
carries them together with a command each way:

- **Islands of the selected parts** — turn a part selection made by `Ctrl`+clicking the model into a
  shape that Fill, Clear, Crop and Copy can work with. A shell that a selected part shares with one
  you did not select comes with it, because those are the same texels; the status line says how many
  extra parts arrived.
- **Parts under these islands** — the other direction, replacing the part selection with every part
  the chosen shells touch. Use it to widen an island pick back out to whole parts, or to find out on
  the model which parts a shell belongs to.

The panel itself is always there, under Brush, whether or not anything is selected — with nothing
selected its verbs are simply disabled.

## Grid, rulers and guides

Two buttons over the 2D view line things up.

**Grid** (`Ctrl+'`) draws the edge of every texel, once you zoom in far enough for a texel to be
worth seeing (600 %). Zoomed out it draws nothing, and turning it on says at what zoom it will show.

**Guides** (`Ctrl+;`) puts rulers along the top and left of the view, numbered in the texture's own
pixels — the same units as the selection's X / Y / W / H — with a lighter band where the sheet is.
**Drag out of the top ruler for a horizontal guide, out of the left one for a vertical guide.** A
guide always sits on a whole texel. To move one, drag its tab on the ruler; to remove it, drag it back
onto a ruler. With painting, Select and the shape tool all off, you can also take hold of a guide
anywhere along its length. Each guide belongs to its texture, every change to one is an undo step,
and **Clear guides** removes all of this texture's guides at once. Guides are not saved with the project.

**Things snap to the guides** when they come within a few pixels of one: the selection rectangle —
its corners as you draw it, its edges as you move or resize it — the shape tool's points, and a flat
decal dragged in 2D, by either edge or its centre, turned or not. Hold `Ctrl` while dragging to place
freely. Hiding the guides turns snapping off.

## The Look under a decal

Every decal carries a **Look** — *Painted on*, *Vinyl sticker*, *Matte stencil* or *None* — chosen in
the decal editor and changeable afterwards: in the sidebar with **Apply to the decal** for a decal
placed flat, and in the decal's panel for a projected one. It is the surface the marking
sits on: gloss, metal and a raised edge, written into the maps War Thunder packs into `_n`.

It arrives **on the decal's own layer** — never as a bake, and never as extra layers beside it. Each
channel the Look writes to is a *derived* channel of the same layer that holds the image: gloss,
metal, the raised edge, and the paint mask when the Custom look's **Paint Δ** is set. So the response
moves, fades, hides, masks and deletes with the sticker, there is no folder to open and nothing to
drag apart, and the slot's own `_n` sheets are never touched. A derived channel is rebuilt from the
Look every time the decal moves, so painting on one by hand is refused rather than lost on the next
move — duplicate the layer (⧉) for a copy that stays put.

**A decal projected onto the model carries its Look too**, on its layer in every texture the
projection lands on. The decal's panel has its own **Look** control for changing it
afterwards; the response is re-derived whenever the decal moves, and `Ctrl+Z` reaches the change like
any other. While a decal is being dragged its response is hidden, and it is rebuilt when the drag
*ends*, not on every frame of it.

**Outline & shadow.** Two more rows on the Look, in the sidebar's *Outline & shadow* section, for
either kind of decal. **Outline** puts a contrasting border round the marking — the standard way a
serial or a code letter is made to read against any camouflage — with its own colour; **Shadow** puts
a soft copy of the shape behind it, offset and blurred, at the opacity you set. Widths are a
percentage of the decal's shorter side, so a Look reads the same on a small marking and a large one.
Both are live while the slider moves and one undo step when it is let go, and both are drawn *into
the image before it is placed*, so a projected decal keeps the same outline width all the way round a
fuselage. The outline counts as part of the marking — the Look's gloss and raised edge run round it —
and the shadow does not.

**Relief — where the raised shape comes from.** Three choices, and the Look's Emboss number is the
strength for all of them:

- **From the edge** (the default) raises the outline. Right for a vinyl sticker, and it does nothing
  at all inside a solid marking — the interior is perfectly flat.
- **Bevelled body** gives the whole marking a rounded, thick edge, worked out from its own outline.
  **Needs no extra file**, which makes it the one to try first.
- **Depth or normal map** takes a greyscale image where light is high — including one generated by
  an outside depth-estimation tool, which is what it is for. It is stretched onto the decal, so it
  should be the same shape as the image, and it is stretched to the range the decal actually covers
  so a crop out of a larger map still has relief. Depth tools disagree about which end is near; most
  output *near = white*, which is what this expects, and **Invert** is there for the ones that do not
  — the wrong polarity turns every ridge into a groove.

  **A normal map works too** — the blue-purple kind. It is recognised when it is loaded and turned
  into a height map, so it rotates, mirrors and wraps round the model with the decal exactly the way
  a depth map does. Normal maps come in two conventions that differ only in which way the green
  channel points: *DirectX* (green down — what War Thunder's own `_n` maps use) and *OpenGL* (green up
  — Blender and many online generators). The app works out which one yours is from the image itself
  and says how sure it is; **File is** shows what it decided and is where you change it. A map made of
  nothing but straight horizontal and vertical lines cannot tell, and is read as DirectX — if its
  relief looks inside out along one direction only, pick the other one. The map's own strength is not
  kept: the Look's **Emboss** sets how strong the relief is, for a normal map as for a depth map.

A projected decal gets the same three: the depth map (or the height made from a normal map) is sent
through the projector with the decal, so it wraps the same way.

*Bake into `_n`* is still there, and still destructive: it writes the look straight into the slot's
surface map, where it does not follow the decal. Use it only when you specifically need it flattened.

## Symmetry

One checkbox mirrors painting **in both views**, decal placement, and decal projection across the airframe. Axis: Auto (detected), X, Y, or Z, plus an offset slider for off-center planes. Decal mirrors live inside the same layer (dashed outline) — no extra layers; "Clear sym copy" removes one.

**It works on the sheet too, and that is new.** Symmetry used to say "(3D)" and mean it: a stroke drawn in the 2-D view was never mirrored. The sheet mirrors *by accident* on some parts and not on others — measured over 14 vehicles, 56 % of a model's mirrored part pairs paint both sides from the same texels and the rest do not, and which is which changes from vehicle to vehicle (an M4A1 Sherman: all 22 pairs; a Pz 38(t): 1 of 16) — so a camouflage painted on the sheet came out mirrored on some panels and one-sided on others, with nothing saying which. Now the app asks the model instead: it reads where each texel sits on the vehicle, reflects that point, and paints the texel that is there. The first stroke on a sheet takes a moment for that (a progress bar, once per texture, and only while Symmetry is on), and after it every brush, every channel and *Stamp along* a path mirror as you draw.

Where the far side of a part lives on **another** texture, or the model is not symmetric there, nothing is mirrored rather than something being put in the wrong place — the stroke says at the end how much of it had no mirror. Filling a closed path is the one thing that does not mirror: a shape is a shape, not a run of dabs.

**On the model, a part that shares its texels with its twin is painted once.** There the mirrored copy — and a Radial copy on a wheel whose spokes share one strip — lands on the very texels the stroke has just painted, so it is not laid a second time: with Flow below 100 % or Build up on, a stroke builds up exactly as fast with Symmetry on as with it off, instead of twice as fast on half of a typical vehicle, and a Panel line comes out as deep as with Symmetry off rather than twice as deep.

**The mirror plane has its own switch.** The translucent blue quad showing where the plane sits is
see-through and sits in front of the vehicle, so leaving it up tints everything behind it in the
view you are painting in. **Mirror plane** is now independent of the checkbox: *While adjusting* (the
default — it appears while you touch the symmetry controls and then gets out of the way), *Always*,
or *Never*. It is also sized to the vehicle now rather than to a square 1.5× its longest side, so it
reads as the centreline instead of as a wall past the nose and tail.

## Seeing one channel on its own

The view dropdown over the 3D view shows any single map flat and unlit — colour, smoothness,
metalness, normal, the wear/coverage mask, and each of the eight raw `_c` / `_n` bytes — which is
the only way to judge a roughness map or the coverage mask that lives in the albedo's alpha.

**Auto** picks for you from the layer you are on: a Smoothness, Metalness or Normal layer switches
the preview to that channel, where the edit is actually visible; Colour and Wear stay shaded. Any
view you pick by hand turns Auto back off, so it never fights you. The choice is remembered between
sessions.

## Decals

Add one by dropping an image file, dragging one out of a web page, or `Ctrl+V` — or letter one with
**Text** (`T`): see *Text — serials, codes and names* below.

- **A new decal lands on the model.** When you add or paste an image (or *Use* one from the library), it goes straight onto the model, projected from the current view onto whatever is in the middle of it, and is selected with its frame and handles showing — nothing waits on the cursor. So line the camera up the way you want it to read first. It is a true planar projection, wrapping correctly across UV seams and panel gaps; selection, protected and hidden parts are respected; symmetry projects the mirrored copy too; it is depth-limited so it won't print through to the far side. Adding it is one `Ctrl+Z`. With no model loaded, or nothing of it in the middle of the view, it lands flat in the middle of the texture instead and the status line says so.
- **One decal, two placements: On the model / On the texture.** The switch at the top of the decal's panel converts it in place, either way, at the same size and turn — *On the texture* lays it flat on one texture, the way that texture is unwrapped (right for a flat panel, or for exact work in 2-D); *On the model* wraps it round the surface again. Its Look, depth map, text and mirrored copy go with it, and each switch is one `Ctrl+Z`. A decal that covered several textures keeps only the one under its middle when it goes flat, and the status line says so. On a texture whose unwrap is stretched unevenly a flat decal cannot follow the stretch, so it comes out at the nearest size and angle.
- **One decal even across several textures.** A marking over a wing root needs a layer in each sheet it covers, but it stays one object: moving, resizing, rotating, hiding, renaming and deleting all act on the whole group, and the layer list marks it `×2 tex`.
- **Moving a decal** — with painting off, just drag it: on the model or on the texture, whichever placement it has, and a press anywhere else still orbits. There is no mode to switch on first. `←↑→↓` nudge, `,` `.` rotate — on the model in the projector's own axes. Grab a decal on the model anywhere inside its blue frame; it holds the point you grabbed, so it does not jump. It re-projects onto whatever surface it lands on, so it never smears, and it picks up textures it moves onto. With painting off it can be **dragged on the sheet** in the 2-D view as well: it holds the point you grabbed and lands on the part of the vehicle under that texel. It keeps its aim while it moves, in either view, so a decal dragged onto a panel facing another way projects onto nothing until you press *Re-aim from this view*.
- **Size / Rotate re-project** from the original image rather than stretching baked pixels — and so do its corner handles and turn knob, which are the same two controls in your hand. **Re-aim from this view** points the projector at the current camera without moving where the decal sits — the fix for one placed from the wrong angle. Because the pixels are regenerated on every move, the brush won't touch a projected layer; duplicate it (⧉) to paint on the copy.
- **Edit a projected decal's image afterwards.** **Open decal editor…** in the decal's panel opens the image the decal was projected from, as it is on the model now: remove its background, crop it, adjust it, turn or flip it. **Use this decal** re-projects it where it is — same place, same angle, and the marking keeps its size even when a crop or a turn changes the image's shape; cropping away a margin that was wider on one side does not move it (a mirrored copy with *Keep the copy's lettering readable* then moves to sit exactly opposite it — the uneven margin had held it off — and the status line says so). A depth or normal map used for its relief is cropped and turned with it, and an outline or shadow keeps its width. It is one step, so `Ctrl+Z` puts the old image back. The Look stays as it was unless you pick another in the dialog. The name box there names the copy **Save** puts in your library; rename the decal itself in the layer list. If an undo or a redo changes the decal while the editor is open, **Use** does nothing and the status line says so — open the editor again.
- **A flat decal** (On the texture) drags in either view too, holding the point you grabbed — on the model it moves while the pointer is over its own texture.
- **Surface response.** The editor's **Look** — painted, vinyl, stencil, or none — is not just the colour: placing the decal also gives **its own layer** gloss, metal and emboss channels, so a vinyl sticker really is glossier and slightly raised on the model. They are part of the decal, not layers beside it: they follow it when you move it and are hidden, faded, masked or deleted with it, and your `_n` texture itself is never written to. A decal **projected** onto the model carries its Look the same way, set in the decal's panel — see *The Look under a decal*. (`Bake into _n (destructive)` is still there if you specifically want it flattened.)
- Edit before applying: background removal (corner/white/black key + tolerance), brightness/contrast/saturation, reset to original. The editor **opens on "Keep as-is"** and changes nothing until you ask it to — keying the corner colour is right on a marking with a white box round it and destructive on a camouflage tile or a photo texture, so it is one click rather than the default. Reopening a decal that is already placed keeps its Look — including an Emboss a depth map gave it — unless you pick a different one. The **Look** list shows the preset the decal's numbers match, or **Custom (this decal's own)** when they match none, with its own numbers in the note underneath; choosing any preset applies it. A decal with no Look opens on **None** and stays that way.
- Surface under decal: bake Painted-on / Vinyl sticker / Matte stencil / Custom (smoothness, metal, emboss) into the `_n` map — applies to the mirrored copy as well.
- **A decal picked with no texture open stays on the cursor**: a small preview follows the pointer,
  so you can load a vehicle or pick a slot and still see what is in hand. It lands the moment there
  is a texture to put it on.

### Text — serials, codes and names

**Text** under the Layers header (or `T`, or *New text…* in the decal library) opens the decal editor on
lettering instead of an image.

- **Type the lettering** in the box; Enter starts a new line. The preview is exactly the image the
  decal will carry, on a grey checker so both black and white letters show.
- **Font.** Any font installed on this computer: the list offers the likely ones this computer has,
  and *Another installed font…* takes any other by name, as other programs list it. Or **Load…** a
  font file — TTF, OTF, WOFF or WOFF2. A loaded font stays in this browser for next time and starts
  at Regular, because a font file is one weight (a heavier one is drawn by thickening it). If the
  font asked for is not here, the line under the controls says so and the text is drawn in a
  fallback.
- **Weight, Size, Tracking, Leading, Align, Colour.** *Size* is the font size in the image's own
  pixels — a bigger size is bigger letters and sharper ones; the decal's *Scale* (its *Size*, once
  projected) then sets how big they are on the vehicle. *Tracking* is the space between letters, in
  thousandths of the size; *Leading* is the distance from one line to the next, as a percentage of
  the size. The three *Align* buttons also decide which edge stays put when the text is edited later.
  Hebrew and Arabic read right to left, tracked or not, and Arabic keeps its letters joined — which
  is also why Tracking leaves Arabic as it is: the browser does not space a joined script.
- **While the dialog is up, the keys are its own.** A letter typed after clicking one of its buttons
  does nothing to the page underneath — `Delete` does not delete the decal you are editing — and
  `Esc` closes the dialog. `Ctrl+S` still saves the project.
- **Use this text** places it like any decal, named after its first line — and from there it is one:
  project it onto the model, give it a mirrored copy (*Keep the copy's lettering readable* keeps a
  serial reading forwards on both sides), a Look, an outline and a shadow. **Save to library** keeps
  it as text, its loaded font with it.
- **Edit it any time.** On a text decal, floating or projected, the panel's button reads **Edit
  text…**: change the words, the font, anything, and **Use this text** draws it again where it is.
  The letters keep their size, and the edge it is aligned on — and its first line — stay where they
  were, so a serial grows the way it is aligned. It is one step: `Ctrl+Z` puts the old text back.
  *Remove background* and *Apply adjust* are off on a text decal, because its image is drawn from
  the lettering — change its colour in *Edit text…*. A **depth image** you loaded onto the text was
  made for the lettering it had, so it is not redrawn with the text: it stays where the old letters
  were, the ones that did not move keep their relief, and the status line says so — load one made
  for the new text to raise every letter.
- **Fonts travel with the project.** A saved project carries the loaded font files its text uses,
  so the text stays editable on a computer that never had them — and **a font's licence travels
  with it**: share a project only where its fonts' licences allow. Fonts that arrive in someone
  else's project are used for that session; saving its text to your library keeps them.

Text along a path is not there yet.

### The decal library, and folders

Anything you clean up in the decal editor can be saved with **Save to library** and reused on any
vehicle, in any project. The library lives in this browser, so it survives reloads.

**No vehicle needs to be loaded to use it.** Opening an image, cleaning it up and filing it is work
you do to *prepare* for a skin, so the decal editor opens on anything and saving never asks for a
texture. If you pick a decal with nothing open yet, it waits on the cursor and drops on as soon as
you choose a texture slot.

- **Click selects, and then Use or Edit.** A click marks the decal; **Use** puts it on the model, **Edit…** opens it in the decal editor first — text opens as text. Double-clicking a card is
  the shortcut for Use. **New text…** opens the text editor over the library, and its Save files the
  lettering in the folder you are in.
- **Three ways to save an edit of a saved decal**, asked at the moment you save it: *overwrite it*,
  *save as a variant of it*, or *save as a new decal*. A variant is an ordinary library entry that
  remembers where it came from — it files itself next to the original, is numbered from it
  (`roundel` → `roundel v2`) and says so on its card, so a family of one marking stays together
  instead of scattering by save date. Deleting an original keeps its variants.

Folders keep it usable once there is more than a screenful:

- **Save straight into one.** The dropdown beside the name in the decal editor picks the folder,
  and offers *New folder…* on the spot. It defaults to wherever you were last, so importing a run
  of roundels one at a time does not mean filing every one of them afterwards.
- **Nest them as deep as you like** — `Roundels ▸ RAF ▸ WWII`. Breadcrumbs across the top walk back
  up; the `..` card goes up one.
- **Drag a decal onto a folder card to move it**, or onto any breadcrumb to move it further up.
- **Right-click a folder** to rename it, or to delete it. Deleting asks what to do with the
  contents: *keep them* lifts everything one level up (so `Roundels/RAF` becomes `RAF`), or delete
  the folder and everything in it.
- **Search spans every folder**, and each hit says which folder it came from — so filing things
  away never makes them harder to find.

A library saved before folders existed opens with everything at the top level; nothing needs
converting, and folders are rebuilt from the decals themselves if the folder list is ever lost.

## Parts, groups, selection

The Parts panel groups meshes automatically into categories that follow the vehicle class:
Airframe, Cockpit & interior, Pylons & racks, Weapons & pods, Glass & canopy, Effects for
aircraft; Hull, Turret, Running gear, Applique armour & ERA for tanks; and so on. Checkboxes
control visibility, solo isolates a part or a whole group. Click part names (or Ctrl+click parts
in 3D) to build a selection — painting, decal placement, and projection then affect only selected
parts. With Painting off, click a part in 3D to jump to its texture slot; `S`+click does it with
Painting on too.

**Inside a category the parts form a tree.** Node names are read as levels, a side and a run
index, so `nozzle2_24` files under *nozzle ▸ nozzle2* (the two nozzle rings stay apart) while
`flaperon_l` and `flaperon_r` share one parent shown as *flaperon (left, right)*. Where there is
no deeper name to split on and the group is large — a landing gear's 82 nodes — the side becomes
the sub-level instead. Everything sorts naturally, so `nozzle2_3` comes before `nozzle2_24`.

**Same-shape detection.** A branch whose nodes come in several distinct shapes is split by shape:
geometry is fingerprinted by triangle count, sorted bounding-box extents and radius of gyration,
all of which survive being moved, rotated or mirrored. That separates an F/A-18's two sizes of
flap, or its inner and outer launcher rails, where the names cannot.

Sub-groups start folded. **Unfold** opens one or two levels for the whole tree; folding a group by
hand always wins over it, and the state is saved in the project.

**Growing a selection.** Click a part, then:

| | |
|---|---|
| `Ctrl` + wheel up / down | widen / narrow one level at a time — the part, its shape, its sub-group, the group above, its category, the model |
| `Ctrl` + `Alt` | add every part whose geometry is identical to the one you clicked |
| `Ctrl` + `H` | show only the selection (again brings everything back) |

Whatever was selected before the click is kept, so widening always adds.

## Slots & textures

Slots pair `_c`/`_n` automatically. "Replace…" swaps the active slot's base texture with any DDS/TGA/PNG (files with `_n` in the name replace the surface map; different sizes are rescaled). Handy for starting from a downloaded skin instead of the factory texture.

Slots with no texture fold into *N slots without textures*; each names the texture it is probably
waiting for. One kind is not waiting for anything: a **utility sheet** — a propeller mask or blur
disc, say — that the game ships in an uncompressed pixel format (L8, A8R8G8B8, …) the editor has no
reader for. Its slot says *utility sheet · L8 · not opened*, the vehicle's load message counts it
apart from anything genuinely missing (*Loaded 17 textures for bf_109f_4 · 4 utility sheets not
opened*), and so does *Advanced ▸ Fill missing slots*, which keeps "not found" for sheets the install
really lacks. In the texture list such a sheet's row is greyed out and names its format (*L8 ✕*). It
is not part of the paint scheme: no vehicle's body or camouflage sheet is one.

## Undo / redo

`Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z`, covers strokes, bakes, layer ops, and settings changes (opacity, blend, decal transforms, adjustments).

**History** in the top bar lists every step, oldest first, with what each one costs. Click any step to
go back to it — the steps after it turn grey and can still be redone, until your next edit replaces
them. A long jump shows a progress bar and can be cancelled; start a stroke, press anywhere outside the
History window or press a key while it runs — any key but Shift, Ctrl or Alt on its own, or what you type
into a checkpoint's name — and it stops where it has got to, so whatever you started begins from a state
the history holds. To mark a moment you may want to come back
to, type a name ("before weathering") and press **Checkpoint**: the step gets a flag, and the name
is listed at the top of the window, one click away. A checkpoint lives in the history, so it goes when
the history can no longer reach it — dropped as the oldest steps are (when the undo memory is full, or
past 250 steps), or replaced by an edit made after undoing past it — and the status bar says so, over
whatever the edit that dropped it had to say. The history is not saved with a project.

**How far back you can go depends on what you did, not on how many times you did it.** History is
trimmed by *memory*, not by a step count — a selection toggle costs a few hundred bytes and a
snapshot of a 4K texture costs hundreds of megabytes — so a session of small edits keeps hundreds of
steps and a session of full-sheet bakes keeps a few. The undo button's tooltip and the Settings
panel both say how many steps are held and how much they cost, and the app tells you once when it
starts dropping the oldest. **Undo memory** in Settings raises the ceiling (default 384 MB, up to
3 GB) if you paint large sheets and find it runs out.

## The top bar, its windows, and the status bar

The top bar runs from what you are making (files, skin name, vehicle, export, undo) through the view
(*3D · Split · 2D*, *View*, the camera button for a screenshot, the side-panel toggle) to the app's
own chrome at the right edge: **?** for help and **Settings** last.

**Export as…**, **History** and **Settings** each open a window under their button. The windows are not modal —
nothing dims, and the Export window stays open while you orbit and paint, because two of its settings
are previewed by the 3-D view itself. Escape closes whichever is open. The **?** screen (*Controls &
guide*) opens above them, and Escape closes it first — as do its ✕ and a click outside its panel.
**View & scene** sits in the right sidebar under the tools you paint with, and the *View* button
scrolls to it; **Moving parts** is a section of its own under it, which appears once the loaded model
has parts that move.
It used to float in a window of its own; that is switched off until it is fixed.

**The status bar** along the bottom of the window says what just happened, in one short line. Click
it for **Messages**: the recent ones in full, selectable, with *Copy*. A line with a dotted underline
has more than it shows — hover it (after opening the game folder, the line counts the vehicles the
list holds, and the counts of models, textures and packs, the textures not opened and why, and the
game's units the list leaves out are there — the same on a visit that reuses the stored index). An
error that does not fit opens by itself.

## Settings

Everything in the sidebars and the windows is remembered between sessions, and every one of them can be put back.
The panel says how many differ from what this build ships — the defaults are read off the app itself
rather than written down, so a control's default is by construction whatever it opens with.

- **Reset** in a section header (Brush, View & scene, Skin & export) puts just that section back.
- **Reset layout** puts the panels back: both sidebar widths, the share between the vehicle list and
  your skins, and the 3D / 2D split. Nothing else. This is the one for "I dragged things around and want them back" — it
  does not touch a brush, view or export setting. (You can also just double-click any drag edge: a
  sidebar's, the bar between the two views, or the line between the vehicle list and your skins.)
- **Reset all settings** does the lot.
- **Export… / Import…** writes every setting to a file you can carry to another machine or keep as a
  backup — the brush tips you loaded go in it too. Nothing is uploaded — it is a file you save and a
  file you pick.

Every one of those asks first, and only when something would actually change: at the defaults
already, it says so and does nothing. None of them touches your indexed game folder, your decal
library or the open project — `Forget folder & cache` is the one for the first of those.

## Export

**Every export setting has a preview of what it does**, in the right half of the Export window.
*Preset / format* shows a 64-texel crop of the sheet where the 2-D view is looking — *as painted*
beside *as exported*, the second really encoded with the chosen format and decoded back, with how many
levels it moved: DXT5 keeps four colours per 4×4 block on one line, so a hard edge with three hues in
one block bleeds, and this is the only place you can see it before the game does. Pan the 2-D view to
move the crop. *Mipmaps* shows the crop at a quarter size two ways — averaged, as a mip chain gives the
game, and point-sampled, as no chain does — with the one you will get outlined. *Seam padding* shows
the same crop with the texels the export will bleed past the island edges tinted, and how deep. *Camo
under skin* and *Alpha* are previewed by the model itself: the viewport blends the camouflage through
the sheet's alpha exactly when the export keeps it, and the sentence under Alpha says which and why.
*Mode* and *inverted roughness* change what the game does with the file rather than a pixel, so their
preview is the sentence under the control.

Presets: Game (BC3 + lossless normals) · WT Live (BC3 everything — Gaijin's recommended format) · Lossless · TGA · Custom per-map. Options: mipmaps (normals renormalized per *generated* level — the full-size level is left exactly as you painted it), seam padding (color dilated past UV island edges — prevents seams in distant mips). **War Thunder accepts a skin with no mip chain at all** — the game's own extracted textures have none — and there is a real reason to turn mipmaps off: with the in-game *older video card support* option enabled, sampling is biased toward a lower mip, so angled surfaces on a mipmapped skin read as blurry. That is the game's sampling, not a fault in the skin. Generates the `.blk` automatically. *To War Thunder* writes straight into `UserSkins/<name>/` (Chrome/Edge); where the browser cannot write there it offers *Download .zip* instead, before encoding anything (Quick start, step 4). Normal maps are always packed to WT's layout: R = inverted roughness, G = normal X, B = metallicity, A = normal Y.

**Textures out** lists every texture you have edited, and each row is yours to control: a tick to
include it, its own resolution, and its own format. The footer keeps a running archive-size estimate
against War Thunder's limit for the vehicle class (70 MB aircraft, 40 MB ground/naval), so trimming
an over-size skin is a matter of dropping one 8K sheet to 2K or unticking it rather than guessing.
Unticking removes the texture **and** its `.blk` line together, so the two always agree — a skin that
ships only a surface map, or only an albedo, is valid and the app will build it. It is also the way
to iterate quickly: leave the sheets you are not working on out and they are not re-encoded at all.
The choices are saved with the project.

**Anything a published skin may not carry is off until you say otherwise.** A cockpit or engine-flame
sheet starts unticked, 8192 px is greyed out unless the vehicle is a rank VI+ aircraft, and the `.blk`
mode the CDK forbids for the vehicle class (replace_tex on a ground vehicle, set_tex on an aircraft)
is greyed out in the Mode list. Each of those shows the same dashed outline and a small ⊘ mark beside
it; the mark's tooltip names the rule, and clicking it enables the control anyway — for a skin you
keep on your own machine. The mark then stays lit in amber for the rest of the session, so an
experiment turned on to test one thing cannot quietly become the state a day of real work was done in.
Reload the page and every gate is closed again.

## Projects

`.wtproj` embeds the model, all source textures, every edit and the font files your text uses — one file restores the whole session on any machine. It is saved wherever your browser saves downloads; reopen it with **Add files…** or by dragging it onto the window. Size runs ~15–35 MB for a jet (deflate-compressed). Older v2 projects still load (they ask for the obj/dds files).

**The resolution you chose to paint at is part of that**, and until 2026-08-28 it was not: a slot raised above the game's own texture size (for crisp decals) came back at the texture's size on the next load, while the layers came back at the size you painted them. Projects saved from now on carry it. A project saved *before* now has it restored from the layers themselves, and the status line says so when that happens.

### Unsaved work, and getting it back after a crash

The app knows when you have work that is in no file yet: **Save proj** carries a small dot and the browser tab's title starts with "•". Undoing everything back to the state you last saved clears both again — unless an edit in between had no undo step of its own (a bake too large to keep one for, a texture loaded into a slot that had none, **Reset surface**): that stays unsaved work until you save. While there is unsaved work, closing the tab, reloading or navigating away makes the browser ask first.

It also keeps a **recovery copy** of your work in the browser's own storage, on this machine only — nothing is uploaded, and the copy holds exactly what a `.wtproj` would. A copy is taken once unsaved work is a few minutes old, at the first moment you are not clicking or painting, and at once whenever you switch away from the tab. None can be taken while the tab is closing — a page that is going away does not get to finish writing one — so a close keeps the work as it was at the last copy, and anything done since is lost if you leave anyway. That is what the browser's question is for. The last two copies of each piece of work are kept, within about 1 GB in all; hover **Save proj** to see when the last one was kept. A copy is not a save — only **Save proj** (`Ctrl+S`) makes a file you can keep, move or share.

If the tab crashed, ran out of memory, was closed by accident or was restarted by a browser update, the welcome screen shows **Recover the session from 14:32** — the work as it was when that copy was taken — with the vehicle, the skin name, the size and how many layers the copy holds:

- **Recover the session…** puts it back exactly as it was when the copy was taken. If the newest copy cannot be read, the older one is used and the status line says so. The recovered work is still not in a file, so save it.
- **Save it as a file…** downloads the copy as a `.wtproj` without opening it.
- **Discard** deletes the copy from the browser (it asks first).

A session you saved to a file is not offered again. If you close the welcome screen without choosing, the offer comes back on your next visit. If the browser remembers your War Thunder folder, it reopens behind the welcome screen as usual, and the screen's first button becomes **Go to the vehicle list**. A copy made by a newer version of the app is refused in words rather than half-restored, like a newer `.wtproj`.

## Shortcuts

`?` controls & guide (`Esc` closes it) · `Ctrl+Z/Y` undo/redo · `Ctrl+S` save project · `B` painting on/off (both views) · `S+click` switch to that part's texture slot · `X+click` protect / unprotect that part · `F9` mark the moment in a session recording · `F` fly · `[` `]` / `Alt+wheel` brush size · `Ctrl+wheel` widen/narrow the part selection · `Ctrl+Alt` select the same shape · `Ctrl+H` solo the selection · `Alt+click` pick color · `Shift+click` line · `` ` `` compare original · `Space`/middle-drag pan · `T` add text · `M` rectangular selection · `K` UV island selection · `L` lasso · `W` magic wand (Shift adds, Alt takes away, with any of them) · `V` UV island outlines · `Ctrl+A` select the whole sheet · `Esc` deselect · `Ctrl+'` pixel grid · `Ctrl+;` rulers and guides (`Ctrl` while dragging places freely). All shortcuts use physical key positions, so they work with any keyboard layout.

## Finding a vehicle

**One search box finds vehicles and your skins together.** Type part of a name and the vehicle list
and the list of skins in your UserSkins folder narrow at once — "leopard" finds the Leopards and
your Leopard skins. It forgives the way people type: "f4e" and "F 4E" are the F-4E, "abrahms" is the
Abrams, "su30" is the Su-30SM, and a mark written in roman numerals answers to its number — "tiger 2"
is the Tiger II, "spitfire 14" the Spitfire Mk XIVs. The closest names come first — the whole
name, then names that start with what you typed, then whole words, then letters inside a name, then
near misses — so "f-4e" puts the F-4E above the F-4EJ, and a vehicle's own name counts before its
internal id, so "mig" lists the MiGs before the Chinese copies whose ids happen to begin "mig", and
a name whose first word you typed comes before one you typed only the start of, so "m1" is the M1
Abrams before the M-17. A typo in the *letters* is forgiven; a different *number* never is, so
"f-15" does not offer you the F-16. A single letter counts only as a whole word, and a nation's
name from its third letter — "isr" lists the Israeli tree, while "is-2" is the IS-2 and not every
Israeli vehicle with a "II" in its name.

Filter by **type, nation and rank** — three chip rows, one choice each. Picking a chip replaces the
previous one and clicking the chip that is already on clears it back to *All*. Nation and rank come
from the game's own files (`shop.blk`'s research tree and `wpcost.blk`), which is why a Hungarian
Leopard is listed under Italy and an Australian Abrams under Britain, exactly as in game. The chips
apply to your skins too, by the vehicle each skin is for. **When something is typed, a match the
chips leave out is not hidden**: it is listed after the ones they keep, under *Outside your
filters*, so a name you can see you asked for is never silently missing. Texture names found by the
search come last, whatever chip is on. **Reset** clears the box and every chip. On a window less
than about 810 px tall (a 1366 × 768 or 1536 × 864 laptop) the nation and rank rows are folded
behind one chip at the end of the type row — a plain flag and *Rank*. Click it, or press Enter or
Space on it, to show or hide them; while they are folded, a nation or rank you picked shows on that
chip, lit, so a filter is never out of sight.

**Sort** orders both lists: *Best match* (the default — the closest names first while you type; with
nothing typed, vehicles in the order the trees use and your skins newest first), *Tree order*
(nation, then rank, then name — a skin by its vehicle), *Name*, or *Rank* (highest rank first, then
the tree's order; vehicles with no rank — radars, SAMs, AI guns — come last in every order).

**With nothing typed it lists every vehicle** the chips let through — so you can browse instead of
having to know a name. A long list loads 200 at a time as you scroll (or press *Show more* at its
end). Within a nation the ranked vehicles come first; things with no rank — radars, SAMs, AI guns,
the C-47 — follow them.

**Every row loads that vehicle's own model** — the one the game's own file for the vehicle names, so
the Kurnass 2000 loads the Kurnass and not the F-4E it is named after, and the A-7E is not a boat.
A vehicle the game lists more than once with the same name, nation and rank (an event copy, say) is
one row; typing any of its ids, or any of their in-game names, finds it. Two rows that would still
look alike — a tank and its skin-pack copy, which fly different models — start their second line
with the part of the model that tells them apart (`…sm_elsa`) — or with the whole model, where
cutting its start would make it read like its neighbour's (the coastal pillboxes, `swe_152mm_coastal_a`
beside `us_152mm_coastal_a`); hover a row for its whole model. The rows that are lit are the vehicles your
skin is for — the ones ticked under *Export ▸ Vehicles* — and they follow those ticks. A row is the
vehicle's name, whole, with its rank and nation on the line below; the row's hover label repeats
both in full when that line is cut short. The arrow at its right end downloads the model as OBJ +
MTL + textures (a `.zip`) without loading it.

**The sidebar stays put while you look.** The search, the chips and the sort never scroll away; only
the two lists do, each on its own. They share the height of the tab — the vehicles more, your skins
less — and a short skins list takes only the room its rows need. Drag the line between the two
sections to give one list more (double-click it to put it back); fold a section by clicking its
heading and the other list takes its space. The share is remembered.

On a short window there is not room for all of it: the headings, the search, the chips, the sort and
the *Load a skin…* row take about 430 px of the tab by themselves. Below a browser page about 810 px
tall — a 1366 × 768 or a 1536 × 864 laptop, for instance — the nation and rank chips fold behind one
chip (above), which gives back about 90 px, and each list starts from its least height — five
vehicle rows, one row for your skins — with the line between them sharing what is left. The vehicle
rows sit a little closer together there (same text, less padding) and the section headings a little
closer to their contents, so five rows fit where three did. On a 1366 × 768 page that is the whole
tab with five vehicle rows; on a shorter one the tab scrolls as a whole, still with five vehicle rows
and the *Existing skin* heading in view at the top (and *Load a skin…* too, from a page about 630 px
tall). On the very shortest pages, under about 600 px, the vehicle list gives up rows before that
heading leaves the view. The search box stays at the top however far you scroll it: the chips and
the sort go first, and the lists come up under the box. Folding *Existing skin* hands its room to the
vehicle list.

## Ground vehicles vs aircraft

The two are not painted the same way, and the export follows the difference.

An **aircraft's** albedo *is* its paint: `replace_tex` swaps the sheet, and that is the whole skin.

A **ground or naval** vehicle is painted from two textures — the detailed sheet you edit, and the
player's selected **camouflage** (`ger_camo_bronzegruen`, `us_camo_olive`…), a near-flat colour
sheet the skin is blended *over*. The CDK states the rule outright: "By default the alpha channel of
the texture is black, which means that this texture is completely transparent and does not affect
the camouflage. If we make the alpha channel white … this texture will completely cover our scalable
camouflage." So the game computes

    final = mix( camouflage, your sheet, your sheet's alpha )

**What the export writes into that alpha is *Skin & export ▸ Alpha*.** On a ground or naval skin,
*Auto — opaque for ground* ships it fully opaque (255), as every published ground skin does:
`set_tex` leaves the vehicle's own texture in place beside your sheet, and the worn edges, scratches
and bare metal come from *that* texture's alpha, scaled by the in-game condition slider — not from
yours. Your sheet's mask ships only when you paint one with the **Wear mask** brush, or set Alpha to
*Keep the source / painted mask*, which keeps the mask the vehicle's texture came with. *Fully opaque
(255)* ships 255 on any vehicle — except that a painted Wear mask always wins. On an aircraft (`replace_tex`) the sheet is the albedo, and *Auto* keeps its
mask. The viewport and the sentence under Alpha follow the same setting.

and a ground skin needs both halves:

1. `set_tex … param:t="camo_skin_tex"` puts your sheet in the user-skin slot. This is what keeps
   in-game decals and the camouflage-condition wear working.
2. `replace_tex` pinning the camouflage, so the skin does not come out a different colour for every
   player depending on what they have selected in the hangar. **Skin & export ▸ Camo under skin**:
   - **Vehicle's own camo** (default) — ships a copy of the real stock sheet. An unmodified skin
     looks exactly like the default vehicle. This is the safe answer.
   - **Solid colour…** — paints the whole vehicle that colour while every bit of the albedo, its
     wear and its detail stay as they are. Same as the *Whole-vehicle base colour* button in the
     Textures tab.
   - **Flat white / mid grey** — the old behaviour. White means "my colours exactly as painted",
     which is only right if you have painted the whole sheet opaque.
   - **My own pattern… (a tile)** — a *scalable* camouflage of your own: see below.
   - **Leave it** — no pin; the player's camouflage shows through wherever your alpha is not opaque.

   The app knows which camouflages to name because they are the `t1` textures of the model's
   `dynamic_masked_*` materials, and it pins each one separately — a vehicle whose interior uses a
   different camo (the M1A2's crew compartment takes `ger_camo_inside_elfebein`) does not get the
   exterior's colour painted inside it.

### Your own camouflage pattern (a tile)

The CDK's other kind of camouflage is a **scalable** one: a seamless pattern the game repeats over
the whole vehicle, which the player then scales and turns in the hangar. **Skin & export ▸ Camo under
skin ▸ My own pattern…** makes one and opens it:

- It is a slot of its own in **Textures** — *wtss_camo_tile*, 1024 × 1024, marked *camouflage tile* —
  and it starts as the vehicle's own camouflage, stretched as a tile so it has no seam where it meets
  itself, and the first stroke lands on the colour the vehicle already wears. Resize it from the
  slot's ⋮ ▸ *resolution…*: it stays square, at 128 to 4096. ⋮ ▸ *load a pattern…* takes any
  picture — a square War Thunder size as it is, anything else stretched to the tile's size (a
  seamless pattern stays seamless; a crop would cut its repeat), and the status line says so.
- **The 2-D view shows it 3 × 3**, the middle copy framed, because that is how it lies on the vehicle.
  Every brush stroke, every path fill and every flat decal **wraps at the edges**: paint over the
  right edge and it comes in on the left, so the tile is seamless without an Offset filter. A stroke
  can start on a neighbouring copy. The Clone wraps both ways — where it paints and where it copies
  from, so a source over an edge carries on from the opposite one — and a flat decal keeps both
  halves when you convert it to paint or export it *on the sheet*. The Wear mask brush is off here
  — see *alpha* below.
- **The model shows it as the game lays it**: through the vehicle's own camouflage UV, a second set
  of texture coordinates every tank model carries for exactly this (not the albedo's). At the default
  scale one repeat covers about 12 m of vehicle — roughly a whole tank. **Preview** under the menu has
  the hangar's two sliders, 20 %–200 % and ±180°, so you can see how the pattern holds up at the
  sizes a player might pick. They are only a preview: **the player owns scale and rotation**, and
  nothing about them is exported.
- **Export** writes the tile as `wtss_camo_tile.dds` (or `.tga`, following its format in *Textures
  out*) and one `replace_tex` pin naming it for each camouflage the vehicle's own skins replace. The
  pin list under the menu shows them, and says which of the model's other camouflage sheets — a
  crew compartment, a deck — keep the game's own, because no skin the game ships replaces those
  either. With no game data to ask (an imported `.obj`), every camouflage sheet is pinned. If
  nothing can be pinned — the tile deleted from its ⋮ menu, or unticked in *Textures out* — the
  warning above the pin list says so, because the skin would then leave the player's camouflage
  showing; **Edit tile** makes a new tile.
- **Alpha.** Every camouflage in the game carries a narrow band of alpha well short of opaque
  (`us_camo_olive` 165–182), and so do published community pins; the tile ships the mean alpha of
  the camouflage it replaces, so however the game uses that channel, your tile uses it the same way.
  The project file keeps that number, because a reopened project has no camouflage sheet to measure
  it from again; *Textures out* says which it is (*the camouflage's own*, *…as the project recorded
  it*, or 255 when no camouflage sheet was ever read, as for an imported `.obj`).
- The tile, its layers and the preview's scale and rotation are saved in the project file. It
  belongs to the vehicle like every other sheet: loading another vehicle drops it and puts *Camo
  under skin* back on the vehicle's own camouflage. To carry a pattern over to another vehicle, load
  the `wtss_camo_tile.dds` an export wrote into the new tile with its ⋮ ▸ *load a pattern…*.

Ships use a different vertex format, whose camouflage UV has not been identified yet, so on a ship
the preview lays the tile over the model's first UV set. The export is the same.

Also class-dependent: the albedo's **alpha is the coverage mask** on ground and naval vehicles (the
Wear mask brush works only for them; on an aircraft it is greyed and says why), and the archive limit is 40 MB rather than 70 MB.

**A note on in-game templates.** The template the game itself writes (the "create camouflage
example" button) carries a "SAMPLE" watermark in its alpha channel, not a usable coverage mask, and
its RGB is a brightened copy of the stock sheet. Import it to see the layout, but if you want the
vehicle to look stock, take the coverage mask back with *Channels ▸ `_c` alpha ▸ right-click ▸
Restore the stock coverage mask*, or start from the game's own textures instead of the template.

## Known limits

- The editor opens the game's **block-compressed** sheets (DXT1/3/5, ATI1/2, BC5, BC7) — every
  vehicle's colour, surface and camouflage sheet is one. About 4 % of the install's textures (2 948
  of 70 693 when measured) are uncompressed or floating-point instead: vegetation wind tables,
  terrain masks, colour-grading and lamp tables, propeller masks. They decompress fine; the editor
  just has no reader for those pixel formats, so they are listed by format (*Advanced* under the
  vehicle search names each one) and not opened. The scan's message in *Messages* counts them.
- There is no skinning path, so bone-driven cloth (camo nets, tarpaulins) is hidden by default and
  marked with a · in the Parts tab. Posing a *rigid* part is fine; it is only skinned meshes that
  cannot be moved.
- Projection paints only the **first surface each ray meets**, so it no longer prints through a fin onto whatever is behind it. To reach a surface that is inside the vehicle, **hide the part in front of it** — a hidden part does not block the beam. (Part scope and protected parts do not: a part you have scoped a layer away from is still solid, so it still blocks.)
- UV-space (floating) decals still distort across seams — use projection for anything near a seam.
- Part stencils (selection masking, per-layer part scope) are rasterized at up to 2048², so on a 4096²/8192² sheet a part boundary is accurate to a texel or two rather than exactly.
- A **Copy** taken off a smoothness, metalness or normal layer that is smaller than the colour sheet — the `_n` usually is half its size — lands at twice its size, centred where it came from. Off the colour sheet, or a layer its size, it lands exactly where it was taken.
- On your own camouflage tile a **selection stops at the tile's edge**: a rectangle, a lasso, a wand's patch or a path's selection that runs onto one of the repeats around it keeps only the part on the tile itself, although strokes and a path's Fill wrap. A wand click on a repeat does take the colour under the pointer.
- A lasso's, a wand's or a path's selection is exact to the texel on every sheet up to 4096² — Fill, Clear, Crop and Copy follow it exactly — but the **brush** follows it at that same 2048² at most, so on a 4096² sheet a stroke's edge along the selection is soft over a texel or two. On an 8192² sheet the selection itself is held at 4096²: its edge falls on every second texel, and the wand compares every second texel's colour.
- 2D painting is clipped by a part selection and by the active layer's part scope, same as 3D painting and projection.
- Seam-crossing strokes subdivide to at most 24 raycasts per pointer move, so a very fast flick with a small brush over a heavily seamed area can still skip a stamp.
- Masks are slot-sized full sheets and go through snapshot undo, so *invert* / *soften* on an 8192² sheet costs a moment and a large history entry.
- A noise, a gradient along the model and a pattern along the model are worked out at up to 2048² and scaled to the sheet, so on a 4096²/8192² sheet their finest detail is a 2048² texel's; a pattern on the sheet is drawn at the sheet's full size. All three need a vehicle loaded, and show nothing on a texture no part of the model uses.
- A pattern on the sheet meets itself across the sheet's edges only at a right angle: at 0° and 180° across the left and right edges, and across the top and bottom too when the tile and the sheet are both square; at 90° and 270° a square tile on a square sheet meets itself at all four. At any other angle a part whose UVs run past the sheet's edge shows a seam there.
- The cockpit carried onto the exterior (*model… ▸ From the cockpit*) is **colour only** — the gloss, metal and relief of that sheet stay stock — and it is a **snapshot**: paint the cockpit again and carry it again (delete the old layer first). The exterior's copy of the cockpit is coarse, so a thin part seen close — the canopy arch from the seat — comes out mottled where neighbouring texels land on different faces of the first-person frame.
- A normal-map tile wrapped along the model keeps each projection's own sense of up, not the surface's, so its bumps can lean the wrong way; the panel says so. Repeat normal detail on the sheet instead.

## History — what the internal 0.x builds added

The 0.x numbers were internal and never published; the version line restarted at
`1.0.0-beta.1` on 2026-10-03. Each entry below is what that build added, as it was written at the
time. Where one disagrees with the sections above, the sections above describe the app as it is.

### New in v0.22 — one layer, every channel

- **A layer stopped being a type you pick before it exists.** *Fill · Paint · Img · Adj* plus a
  "New layer on" dropdown are gone. There is one **+ Layer** button, and the selected layer carries
  a **channel strip**: five chips saying which of colour, smoothness, metalness, normal and the
  paint mask this layer holds, and what is in each. A `+` chip adds one, its arrow converts, moves
  or removes it. Layer rows show the same as coloured dots instead of a type tag.
- **The brush makes the channel it needs.** Selecting a colour layer and picking the Smoothness
  brush used to grey the tool out and tell you to go and find a smoothness layer. It now writes a
  smoothness channel *into the layer you are on*, creating it on the first stroke, in the same undo
  step as the stroke.
- **Change a layer's content after the fact.** A fill becomes painted pixels; painted pixels become
  a flat fill; a placed image bakes into pixels where it stands. Each is named with what it costs,
  and each is one Ctrl+Z.
- **Effects work on the greyscale maps.** Hue, saturation, brightness and contrast used to be
  refused off the albedo. Contrast on a roughness map is an ordinary layer now.
- **A decal's Look stops making a folder.** Gloss, metal and the raised edge are channels of the
  decal's own layer, so they move, fade, hide and delete with it — and the rule that used to stop
  you dragging one of them out of its folder is gone, because there is nothing to drag. Painting on
  a derived channel by hand is refused rather than silently overwritten on the decal's next move;
  duplicate the layer for a copy that stays put.
- **Projects are version 5.** Older `.wtproj` files load and are migrated forward as they open —
  including decal folders written by v0.21 and earlier, which fold into their decal. A file written
  by this build will not open in an older one.
- **Mirror ↕.** Decals and projections had a left-right mirror and no top-to-bottom one. There is now
  one button for it — it is the left-right mirror and a half turn, done together in one undo step,
  which is what you were doing by hand and getting the order wrong.
- **A mirrored decal copy can keep its lettering readable.** A mirrored copy is a true reflection, so
  a serial or a name came out backwards on the far side of the aircraft. Tick *Keep the copy's
  lettering readable* and the copy stays exactly where it is while the image reads the right way
  round. Leave it off for a shape that should point forward on both sides — a shark mouth, an arrow —
  where the reflection is what you want. New copies are ticked; existing projections are untouched.
- **Groups have a “pass through” blend.** Normally a group flattens its children and treats the
  result as one layer — which is what makes it a group, and also why an adjustment inside one only
  affects its siblings. Set the group's blend to *pass through* and the adjustment reaches the layers
  beneath the group instead. The group's own mask, part limit and opacity still apply.
- **Canopies and other coated glass render as glass.** A cockpit with a rainbow, gold or smoked
  coating came out flat white and opaque: those materials carry no texture at all and most of them
  have no name either, so the viewport had nothing to recognise them by. It reads the shader class
  now, and the coating's own name picks the tint — and a *rainbow* coating has its rainbow: a
  thin-film sheen that cycles with the view angle at a canopy's edges, the way the hangar shows it.
  Preview only — none of these is painted or exported.
- **A decal saved to your library keeps its relief.** The depth map and the relief settings (mode,
  bevel width, invert) went with the image before; now the library carries both, and opening a
  placed decal in the editor no longer throws them away either.
- **Tiled parts can be painted.** A rifled gun barrel textured by repeating one strip six times had
  five of those repeats invisible to every tool — a brush stroke on them landed nowhere and a part
  selection under-covered. The sheet is the unit square, so every repeat now paints the same texels,
  which is what the game renders — and a projected decal aimed at any repeat lands there too.
- **Paste a texture in as a layer** (*Textures ▸ Paste as layer…*) instead of replacing the slot's
  base sheet. The model's own maps come first, the rest of the vehicle's are marked as not lining
  up, and anything you added by name from the game search is there too. Each one lands on the
  channel it came from, so a packed `_n` arrives as smoothness, metalness and normal rather than as
  a picture of nothing on the albedo — and nothing is written over, so it masks, fades, reorders and
  undoes like any layer. *Note that a `.wtproj` embeds its textures: a project carrying a pasted
  game texture ships that texture to whoever you send it to.*
- **A selection and a mask go both ways.** *Selection → layer mask* takes the whole selection —
  rectangle, UV islands and parts — not just the parts half, which is all the old button could see.
  *Mask → selection* is new in both directions: a mask you painted or softened becomes a selection
  shaped like the mask, not like its bounding box.
- **A layer's limit is a recipe, not a parts list.** Draw a rectangle, add a layer, and the layer is
  limited to it — exactly, through a resize, and clearable any time. The row is called **Limit** now
  because it is no longer only about parts.
- **The 3D / 2D switch fills the window.** After you had dragged the divider, switching to 3D or 2D
  hid the other pane but left the survivor at its old share of the width, with empty background
  beside it.
- **Holding Ctrl+V no longer opens a stack of decal editors**, and dropping several images at once
  opens one at a time.
- **The two decal placement buttons say what they are waiting for.** Both arm a click on the model;
  neither used to change when you pressed it. And "move this decal on the surface" no longer tells
  you to click it onto the model when that is exactly what you just did — UV placement and
  projection are different things, and the message now names the one you need.
- **Noise and patterns.** A fill can be a **noise along the model** — Perlin grime, blotchy value
  noise, cells for spots and chips, or streaks running down the vehicle — seeded, sized in metres and
  seamless across the UV seams, and **noise…** in the Mask row masks a layer by one. A fill can also
  **repeat an image of your own**, across the sheet or wrapped round the model from three sides. See
  *Noise and patterns* under Layers & masks.
- **It opens with no connection, the first time too.** The 3D view and the zip library used to be
  downloaded from a CDN the first time the page was opened, so a laptop that had not been online,
  or a school or work network that blocks CDNs, got a page with no 3D view. Both are inside the
  `.html` file now, and the page fetches nothing at all.
- **The search forgives, and finds your skins too.** "f4e", "abrahms", "su30" and "tiger 2" used to
  answer *No matches*; now they find the F-4E, the Abrams, the Su-30SM and the Tiger II, closest
  names first — but a different number is never taken for a typo, so "f-15" does not offer the
  F-16. The one box searches your UserSkins list as well, a match your type / nation / rank chips
  leave out is listed below the rest under *Outside your filters* instead of vanishing, and a
  **Sort** control orders both lists. See *Finding a vehicle*.
- **The search box no longer scrolls away.** The Vehicle tab used to scroll as one long column, so
  looking down the results took the box you were typing into off the top. Now only the two lists
  scroll; they share the tab's height by a line you can drag, and folding a section hands its
  room to the other list. On a window too short for all of that — most laptops — the vehicle list
  keeps the 210 px (about four rows) it always had and the tab scrolls as well, but the search box
  stays at the top.
- **Brush tips and tip dynamics.** Every brush used to paint a round dab. Pick a *Square*, a *Rivet*,
  a paint *Chip*, or load any image as a tip, and vary each dab's size, flow, angle and position —
  scattered chips for weathering, rivets that follow a curve, stencilled dots. Each tool keeps its own
  tip and dynamics, loaded tips stay in the browser and travel with a settings export, and a Round
  tip with no dynamics paints exactly what it did before.
- **Your layers in Photoshop, Paint.NET, Krita or GIMP, and theirs here.** *Export all layers for
  another editor* writes the texture's whole stack as a `.psd` or an `.ora` that opens looking like
  the texture, and dropping a `.psd` or `.ora` in brings its layers back as paint layers, masks and
  clipping kept, with everything that could not come across named. See *Into Photoshop, Paint.NET,
  Krita or GIMP, and back* under Layers & masks.
- **Each vehicle row loads its own model.** The list matched vehicles to models by name, so 126 rows
  — the A-20G, the Thai A-7E and the A13 Mk I among them — loaded a generic boat, the Kurnass 2000
  loaded the F-4E, and about 225 ranked vehicles had no row at all. Each row now loads the model the
  game's own file for that vehicle names. Radars, SAMs and other unranked things no longer lead every
  nation, identical rows (the F-4E and its event copy) are one, and loading a vehicle lights only
  the vehicles your skin is for. See *Finding a vehicle*.
- **Vehicle names are whole in the list.** Every name was cut to a few characters ("F-4E Ph…")
  because a hidden *Load ▸* label and a flag took the room; the name now has the row's width, and
  the flag's nation is on the second line and in the row's hover label. The download icon reads as
  a button rather than a disabled one, and a vehicle with no class shows a box rather than something
  that looks like an empty checkbox. On a laptop-height window the nation and rank chips fold behind
  one chip, so the vehicle list keeps its rows and *Existing skin* stays in view.

### New in v0.21 — the Arms tab builds loadouts

- **Text on a pylon or a store is no longer written backwards.** A store hung straight off a
  station was placed by a *reflection*, so it wore its texture mirrored — stencilling, serials and
  markings all read the wrong way round. Stores on a rack were unaffected, because two reflections
  cancel, which is what "some of them" meant. The −1 that caused it turns out to be the model
  format's own convention on **every** node (308 of the F-4E's 312, including the pilot and the
  airbrakes), not a per-station mirror; undoing it is one row negation. Stores land in exactly the
  same places as before.
- **The station list is the loadout.** The Arms tab used to be two flat lists — every purchasable
  loadout, then every station with every preset under it — and clicking a station's preset *replaced*
  the whole aircraft with it. Now each station row says what it is carrying, clicking it unfolds
  what it can carry, and picking one hangs it there and then — that station alone, no Apply step,
  the way the game's loadout screen works (2026-09-21).
- **Loadouts of your own.** Fill the stations from one of the game's purchasable loadouts and change
  what you like — it is marked *edited* the moment it stops matching. Name it and it is kept
  between sessions and travels with a settings export.
- **The loadout is saved in the project** and hung again when you reopen it. Without the game folder
  open, or if the game has since dropped the station, the build still comes back in the panel and
  the status line says why it could not be filled in.
- **What the build weighs**, out of the store definitions themselves, against the vehicle's own
  maximum load — so an arrangement the game would refuse says so in the panel.

### New in v0.20 — armament

- **Stores hung straight off a pylon are lit properly again.** A single bomb on a station rendered
  pale and unlit while the same bomb on a triple rack beside it looked right, and so did every
  sub-pylon. Placing a store at a station reflected its
  triangles as well as its position and the surface ended up lit from inside; two reflections cancel,
  which is why racked stores were unaffected. The store lands in exactly the same place as before —
  only its triangle order changed. (Why the reflection was there at all was only understood in
  v0.21, above; this fix put the lighting right and left the texture mirrored.)
- **Rocket pods carry their rockets.** A Zuni, Hydra or FFAR pod showed one rocket at its centre.
  Pods do not list their stations the way other racks do — they state a round count and leave the
  tubes to the pod model's own skeleton — so those are read out of the model now. A LAU-10 gets its
  four, a LAU-131 its seven, a LAU-61 or M261 its nineteen.
- **A vehicle opens showing its own pylons, with nothing fitted.** *Arms ▸ weapons* and *▸ pylons*
  both start on: racks and pylons are part of the airframe and get painted with it. The stations
  stay empty, and the loadout list starts with an explicit **clean airframe** row — the game's own
  first preset is not empty (an A-10C's is three drop tanks), so this one is the app's.
- **Clearing a project clears the Channels panel** instead of leaving the discarded texture's
  thumbnails and numbers on screen.

### New in v0.17 — colour fidelity

- **Importing a skin and exporting it again gives you the same skin back.** It did not. Two things
  were being thrown away silently, and neither is visible in any RGB view of the file:
  - the albedo's **alpha** — the coverage mask the game blends your skin over the camouflage with —
    shipped as 255 everywhere whenever the export could not find its cached copy, so the skin
    covered the camouflage completely and the vehicle came out flatly repainted and permanently
    clean. The mask is now derived at export time, from the wear stack if you painted one, from the
    imported texture if you did not, and straight out of the decoded source if all else fails.
  - the **camouflage the skin sits over** was pinned to a flat *white* 64 px sheet — every camo the
    model uses, including the interior one. On an M1A2 that turned `us_camo_olive` (82, 74, 54)
    into white under 63 % of the sheet. **Skin & export ▸ Camo under skin** now defaults to
    *Vehicle's own camo*, which ships a copy of the real thing, and each camo is handled separately.
    If the skin you loaded already carried its own pin, that pin is kept.
- **Paint the whole vehicle one colour, properly.** *Textures ▸ Whole-vehicle base colour* pins the
  camouflage underneath instead of flooding the sheet with a fill. Every bit of stock wear, dirt,
  panel detail, the coverage mask and in-game decals survive — this is the same mechanism the game's
  own camouflages use.
- **Every byte of the texture is reachable.** *Textures ▸ Channels* shows both sheets as what they
  actually are — `_c` = colour in RGB, coverage in alpha; `_n` = inverted roughness, normal X,
  metalness, normal Y — with a thumbnail and mean for each. Click one to see it flat on the model,
  right-click for fill / invert / brightness-contrast / restore-stock-mask. All undoable.
- **The preview does the game's blend.** `mix(camo, skin, alpha)` with the real camouflage texture
  bound, instead of an approximation from its average colour. A sheet whose mask has been flattened
  now *looks* flattened.
- **Loading a different vehicle clears the previous one's textures**, including when a dropped skin
  asks to load the right vehicle first.
- **The UserSkins folder is asked for once and remembered.** An unrelated export failure no longer
  forgets it, and "Load a skin…" points at the list already on screen rather than opening a picker.
- Wear fills default to *multiply*, so they darken the imported mask instead of replacing it.

### New in v0.15

- **Nothing is ever painted onto the game's own texture.** Every brush writes to a layer. With no
  layer selected, the first stroke creates the one that tool needs and folds it into the same undo
  entry, so one Ctrl+Z removes the stroke and the layer together. Before this, every tool except
  colour and the eraser quietly edited the imported map itself when the layer stack was empty.
- **The albedo's alpha is the *coverage* mask, and the preview finally shows it.** A ground or
  naval skin is blended over the player's camouflage using that alpha: white covers it, black lets
  it through, greys are the worn edges and bare chassis the stock textures carry. The viewport now
  blends live — paint an opaque colour and the camouflage disappears exactly where the game would
  hide it; take the **Wear mask** brush to it and the camouflage comes back through. Both views
  agree, and both match what the exported `.dds` will contain. *Keep wear / coverage mask* drives
  the preview too, and *View & scene ▸ Use coverage mask* turns the blend off if you want to judge
  colours flat.
- **A tank the unit list could not place is no longer treated as an aircraft.** That fallback cost
  it the wear-mask brush entirely and gave it `replace_tex` instead of `set_tex` +
  `camo_skin_tex` on export. The shape of the model decides now.
- **Moving parts** (*View & scene*). Swing the gear up, drop the flaps, open a canopy or a hatch,
  traverse a turret — so you can paint the surfaces the default pose hides. It now plays the
  vehicle's **own baked animation** out of the game files, so the parts move exactly as they do in
  game: sliders run 0 (retracted / closed) to 100 (extended / open), which are the game's own frame
  numbers, and each rests at the frame the model is drawn in. That also brings parts no hinge could
  be guessed for — arrestor hooks, swing wings, radiators and the individual petals of an exhaust
  nozzle (an F-4E has 34 a side). Vehicles with no clip, and imported `.obj` files, fall back to a
  hinge inferred from the shape of the part with a conventional range; those show a dimmed label.
  Tank turrets, guns and hatches always use the inferred hinge, because a tank's clip carries only
  track roll. Preview only.
- **Tracks show both faces**, so the far side of the vehicle no longer shows the back of the near
  track as a dark band.
- **Opening the game folder is fast the second time.** The whole index — every texture entry, every
  model-pack record — is stored between visits and restored in about a third of a second, keyed to
  your install so a game patch refreshes it by itself. The first scan is concurrent now rather than
  one pack at a time. *Advanced ▸ Rescan install* forces a full re-read.
- **4K and 8K sheets are responsive.** One canvas hint was pinning every texture to a CPU surface
  and costing 218 ms per frame at 8192²; the 2-D view now draws only the slice you are looking at,
  and the coverage mask never crosses back from the GPU. See the changelog for the measurements.

### New in v0.14

- **A vehicle loads as a bare airframe.** No question about what to bring with it — both answers
  loaded the same geometry and only differed in what was shown, so it is a display option now. No
  stores are hung, and the model's own pylons, racks and built-in pods are hidden. **Picking a
  loadout turns back on exactly what that loadout brings** — the stores it hangs, and the airframe's
  own pylons only if it leaves some on show — so neither switch has to be found by hand; both are
  still there in the Arms tab and under *View & scene*. Which nodes count as mounting hardware comes from the game's
  own `WeaponSlots` (each station's emitter node plus the ShowNodes/HideNodes it switches per
  loadout), not from their names — which is why an A-4E no longer arrives with gun pods under its
  belly.
- **Jet flames, muzzle flashes and flares are switchable** (*View & scene*) and off by default. When
  on, they are drawn from the game's own effect sheet (`jet_flame_diamonds`, `gunfire`), added over
  the model the way the game adds it, so the edges of the flame cards do not show. With the stock
  sheet that is the glowing ring inside the nozzle; the long afterburner plume you
  see in flight is a separate volumetric effect of the game's, which no skin can change and the
  preview does not draw.
- **One painting switch** — the button under the brush, either view's button, or `B` — covers both
  views. The tool row is only tools; picking one up turns painting on. With painting off, a drag in
  the 2D view pans.
- **A brush ring is projected on the surface**, sized from the hit triangle's texels-per-metre, so
  it shows the brush's real footprint rather than a fixed screen circle. The 2D view draws the same
  circle; the inner ring is where a soft brush stops being opaque. *(Since v0.22's brush tips, the 2D
  view outlines a Square tip as its square; the ring stays the circle the Size spans — see Brushes.)*
- **Painting across a UV island border no longer streaks or gaps.** A real seam crossing is
  recognised from the geometry (each triangle's own texel density), and the pointer's travel is
  walked in small steps that are each raycast for their own surface point.
- **Shift+click draws a line that is straight on the model.** It used to interpolate in texture
  space, which is straight on the sheet and arbitrary on the vehicle — the paint ran through
  whichever UV islands lay between the two coordinates. It is now walked across the screen from the
  last stroke's end point with every step raycast, so it follows the surface. (In the 2D view a
  straight line on the sheet is still what you get, because that is what you are drawing on.) It
  also used to give up past ten brush diameters and leave a single stamp at the far end.
- **Ground and naval skins get the stock camouflage neutralised**, which is what every hand-made
  ground skin does and the app did not: without it the game tints your paint with the vehicle's
  camouflage texture and a grey scheme comes out bronze-green. See *Ground vehicles vs aircraft*.
- **Masks work like a texture painter expects.** Add one white or black, from the parts you have
  selected, or **from a texture** — the model's own albedo / smoothness / metalness sheets are
  listed with previews and an **invert** switch, and the same dialog takes an image file. Then
  paint on it, **invert**, **soften** it into a fade, fill it, or replace it — all undoable. The
  mask shows as its own thumbnail beside the layer's content; click it to paint on it. Masks now
  work on every channel: masking a Metalness or Wear layer used to change nothing on screen.
- **Only the settings that apply.** A fill on smoothness / metalness / normal / wear takes a value,
  not a colour; blend modes that operate on hue and chroma are not offered there; an adjustment
  layer off the colour channel is refused with the reason instead of silently doing nothing.
- **Rank is a chip row like type and nation** — one choice each, and clicking the chip that is
  already on clears it. The results sit in a scrolling box about five rows tall that you can drag
  taller (the height is remembered). With nothing typed the order is the in-game one: nation, then
  rank, then name.
- Loading a plane opens the **airframe** texture in the 2D view, not the cockpit. The USSR tree
  flies the Russian tricolour.

### New in v0.11

- **Parts are mesh nodes, not material slices.** One node that uses three materials used to be
  three unrelated entries in the Parts tab, usually on three different textures — select one,
  fill, and the others stayed unpainted. The tab now lists the node and takes all of its pieces,
  and a fill / adjustment / paint layer made from a selection is created on **every texture the
  selection covers**, linked, so one edit reaches all of them and one Ctrl+Z undoes it.
- **No more pale lines along part and island borders.** Part stencils are rasterised as one path
  for the whole selection, driven fully opaque, and grown a couple of texels into the padding
  around each UV island (*View & scene ▸ Advanced ▸ Paint bleed*).
- **Ctrl + right-click a part in 3D with nothing selected shuts that part out of painting** —
  "everything except this one" no longer needs a 300-part selection. Select all / none / invert
  live in the Parts tab; Alt+click a row does the same as Ctrl+right-click in 3D.
- **Sub-groups build themselves from the model's naming** — `gear_l` / `gear_r` / `gear_c`,
  `slat_l` / `slat_r`, `us_m61_gun_barrel` — instead of one flat list per category.
- **Layers work on every channel.** Colour, smoothness, metalness, normal, or the wear mask. Same
  blend modes, opacity, masks, part limits and links on all of them, and surface edits are finally
  non-destructive. (Since v0.22 one layer can carry several of them at once — see *Layers & masks*.)
- **One channel at a time in 3D.** The viewport's channel dropdown renders any single map flat
  and unlit; the **Channels** switches under the slot list hide a map in the shaded view.
- **Exposure with an Auto button** at the top of View & scene. Flip V, light-follows-camera and
  show-unposed-parts moved to Advanced and stay off by default.
- **The stock camo preview no longer leaves tanks and ships rusty** — it keeps the detail sheet's
  light and takes the camo texture's colour, instead of multiplying one by the other.
- **Arms tab: every weapon preset the vehicle can actually carry**, read from the game's own
  `wpcost.blk`. Loading a model asks whether to bring pylons and weapons; everything arrives
  hidden, and picking a preset shows that preset plus the racks it needs. Weapons are ordinary
  parts with ordinary texture slots, so they paint and export with the skin. A weapon can also be
  opened on its own, and a saved weapon project merged into a vehicle project.

### New in v0.5

- **Game extractor finished** — every texture format in the game now decodes in-browser: Oodle-compressed (Kraken/Leviathan, via RAD's decoder compiled to WASM — built locally from the UE-EULA source; don't redistribute the HTML with the embedded blob), BC7, ATI1/BC4, plus the existing DXT1/DXT5/BC5 with raw/zstd/zlib. Coverage went from ~10% of entries to ~97%.
- **Full-resolution textures** — the game ships each texture at up to 4 quality tiers ($tq/base/$hq/$uhq). The browser now groups them by name and loads the *largest tier your install actually has* (e.g. `b_52h_c` resolves to 8192², not 512²). A quality dropdown (Auto/HQ/Base) picks smaller loads; stub tiers fall back automatically. Non-decodable entries are counted in a diagnostic line instead of silently hidden.
- **New welcome screen** — three ways in: **Start from game files** (index your WT folder → add the vehicle .obj → all slots fill from the game automatically), **Open a project** (.wtproj), or **Empty project** (add a model and your own textures; "Fill missing slots from game" completes the rest any time).
- **Editable part groups** — groups fold; select parts and move them to any group or a new custom one (rename/delete custom groups). Groups, fold state, and the current part selection are saved in the .wtproj, and all group/selection edits are undoable with Ctrl+Z.
- **Missing-texture slots fold away** — slots with no texture collapse into one row and each shows the texture names it's probably waiting for (e.g. `mig_21_c · mig_21_n`).
- Game textures embedded in projects are now stored in their original compression (much smaller .wtproj for HQ textures).

### New in v0.4

- **Game files (beta)** — point the app at your War Thunder folder and it indexes every texture in the game's `.dxp.bin` packs (read-only, parsed in-browser: DxP2 index → DDSx → zstd/zlib decode). Search any vehicle's textures and load them: "add" auto-binds by name, "→slot" applies as the active slot's base — the way to start from any stock camo. Oodle-compressed / BC7 entries are listed but marked 🚫 (not decodable yet).
- **Real sub-parts** — the OBJ's own mesh designations are now honored: your F-4E splits into 228 named parts (`elevator0`, `airbrake_l`, `rudder`, `gear_c7`…) grouped into Control surfaces, Landing gear, Cockpit, Pylons, Weapons, Glass, Effects. Selection grays out everything else.
- **Brush fixed** — strokes now accumulate in a per-stroke buffer applied once at stroke opacity, which removes the darkening ring at brush edges; repeated clicks and hand-fills now build up cleanly and evenly. New Spacing slider controls stamp density.
- **Alt+click color pick works everywhere** (2D any mode except mask, and in the 3D view), and plain clicks no longer nudge the camera — the orbit pivot only moves once you actually drag.
- Shift+click draws straight lines in 3D paint mode too.

### What's new in v0.3

Layout-independent shortcuts (physical keys, works with any system language) · orbit pivots around the point you grab · camera view presets + reset · WASD fly mode (`F`) · brush stroke spacing · true decal projection · in-layer decal mirroring with X/Y/Z/auto axis + offset · mesh smart groups with selection-scoped editing · replace base textures · self-contained projects · collapsible panels · settings remembered between sessions.
