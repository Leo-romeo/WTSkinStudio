/*==TOOLS==*/
"use strict";
// ---------- Tools and channels are two axes, not nine modes ----------
// ROADMAP 4.28(d). `App.brush.mode` was one enum of nine values that answered two different
// questions at once — what the gesture DOES and where it GOES:
//
//     color / erase      the albedo, with two different gestures
//     smooth / metal     the same gesture, on two different maps
//     flatten / height   two genuinely different gestures, both on the normal map
//     mask               a TARGET wearing a tool's clothes
//     none               not a tool at all
//
// Written that way, "paint smoothness with the eraser" is not a thing you can express, "carve a
// panel line into a mask" is not a thing you can refuse in words, and every place that wanted a
// mode's channel had to carry its own copy of the table. There were four such copies — `BRUSH_CHAN`
// in `brushes.js`, `brushModeChan` and `brushTargetChan` in the brush panel (byte-identical to each
// other), and a fourth spelling of the same fact inline in `draw2DNow`. They are one table now, and
// it is this one.
//
// The three axes:
//
//   * **tool**    — the gesture. Brush, Eraser, Clone, Panel line, Flatten, and "none" for painting
//                   off.
//   * **channel** — the sheet it lands on: colour, smoothness, metalness, normal, paint mask.
//   * **target**  — the layer's own pixels, or the layer's mask. The mask stops being a brush.
//
// Every one of the old nine is a point in that space (`MODES` below), so nothing is lost and
// nothing outside this file had to learn a new vocabulary at once: `App.brush.mode` is an accessor
// over the three axes, exactly the way `L.type` became an accessor over a layer's content in (b).
// Prefs, the recorder, the per-tool settings map and five tests still speak modes; `paintTarget`
// and the brush panel speak axes.
//
// **The pairs that do not exist are refused in words rather than being unrepresentable.** That is
// the point of splitting the axes: with one enum, "the Eraser on the smoothness channel" simply had
// no name, so the only possible answer was silence. `Tool.resolve` answers every one of the fifty
// pairs — 5 tools x 5 channels x 2 targets, sixty since the Clone made it six tools — with either
// a mode or a sentence saying what to reach for instead. `tools/t61_tools.mjs` walks all sixty.
const Tool = {
  // `chans` is what the tool can write, in the order a message should list them. The Brush is
  // deliberately NOT "every channel": the normal map is reached by Panel line (carve a groove) and
  // Flatten (take one out), because a grey value smeared onto a normal map is not a bump, and a
  // tool that does nothing and says nothing is the thing §4 forbids.
  TOOLS: {
    brush:   { label: "Brush",      chans: ["color", "smooth", "metal", "wear"], mask: true,
               instead: "Panel line carves a bump into the normal map and Flatten takes one out." },
    // `emptyErr` is what a tool that needs existing pixels says when there are none. It lives with
    // the tool rather than in `paintTarget`, so the one place that refuses reads the same sentence
    // the panel disables the button with.
    eraser:  { label: "Eraser",     chans: ["color"],  mask: false, needsPixels: true,
               emptyErr: "Select a paint layer to erase from",
               instead: "Paint over it with the Brush, or lower the layer's opacity." },
    // The Clone copies pixels from elsewhere on the same sheet (ROADMAP 4.44, fourth candidate) —
    // the colour, or the normal map, which is where the rivets and panel lines live post-2022.
    // Smoothness and metalness are refused in words rather than offered: one channel per stroke is
    // the tool model, so each would be another button, for a copy nobody has asked for yet.
    // `needsSource` is the eraser's `needsPixels` one step earlier — a copy needs somewhere to copy
    // FROM — and `sourceErr` is the sentence `paintTarget` refuses with until Alt+click has set it.
    clone:   { label: "Clone",      chans: ["color", "normal"], mask: false, needsSource: true,
               sourceErr: "Alt-click the spot to copy from first, then paint where it should go",
               instead: "It copies the sheet the rivets and panel lines live on — the colour, or the normal map." },
    height:  { label: "Panel line", chans: ["normal"], mask: false,
               instead: "It carves into the surface, so the normal map is the only sheet it means anything on." },
    flatten: { label: "Flatten",    chans: ["normal"], mask: false,
               instead: "It takes bumps back out of the surface, so the normal map is the only sheet it means anything on." },
    none:    { label: "No tool",    chans: [],         mask: false },
  },
  TARGETS: { content: "the layer itself", mask: "the layer's mask" },
  // The nine legacy modes as points in the space. `mask` carries no channel because the mask brush
  // edits whatever channel its layer writes — which is why the axis it moves is the target, and the
  // channel is left exactly where the user had it.
  MODES: {
    color:   { tool: "brush",   chan: "color",  target: "content" },
    erase:   { tool: "eraser",  chan: "color",  target: "content" },
    wear:    { tool: "brush",   chan: "wear",   target: "content" },
    smooth:  { tool: "brush",   chan: "smooth", target: "content" },
    metal:   { tool: "brush",   chan: "metal",  target: "content" },
    flatten: { tool: "flatten", chan: "normal", target: "content" },
    height:  { tool: "height",  chan: "normal", target: "content" },
    clone:   { tool: "clone",   chan: "color",  target: "content" },
    cloneN:  { tool: "clone",   chan: "normal", target: "content" },
    mask:    { tool: "brush",   chan: null,     target: "mask" },
    none:    { tool: "none",    chan: null,     target: "content" },
  },
  label(tool){ const T = Tool.TOOLS[tool]; return T ? T.label : String(tool); },
  // Quotes a name the user did not choose, so a typo in a saved preference reads as a typo.
  q(v){ return "“" + String(v) + "”"; },
  chanWord(ch){ return String(CHAN_LABEL[ch] || ch || "").toLowerCase(); },
  takes(tool, ch){ const T = Tool.TOOLS[tool]; return !!T && T.chans.indexOf(ch) >= 0; },

  // ---- the one question every caller asks ----
  // Either `{ mode }` — the legacy name of this point, which is what the rest of the app still
  // speaks — or `{ err }`, a sentence for the user. Never both, and never neither.
  resolve(tool, chan, target){
    const T = Tool.TOOLS[tool];
    if (!T) return { err: "There is no " + Tool.q(tool) + " tool." };
    if (tool === "none") return { mode: "none" };
    if (target !== "content" && target !== "mask")
      return { err: "A stroke goes either into the layer or into its mask — " + Tool.q(target) + " is neither." };
    if (target === "mask") {
      if (!T.mask) return { err: T.label + " has nothing to do on a mask — a mask is one grey value per texel, " +
        "so the Brush paints it and Alt-paint reveals." };
      return { mode: "mask" };
    }
    if (!CHAN_LABEL[chan]) return { err: "There is no " + Tool.q(chan) + " channel." };
    if (!Tool.takes(tool, chan))
      return { err: (T.label + " writes the " + T.chans.map(Tool.chanWord).join(" / ") + " channel" +
        (T.chans.length > 1 ? "s" : "") + " — not " + Tool.chanWord(chan) + ". " + (T.instead || "")).trim() };
    const m = Tool.modeOf({ tool, chan, target });
    // Unreachable while MODES covers every takes() pair, and asserted by t61 rather than assumed: a
    // tool added to TOOLS without a mode for each of its channels would otherwise resolve to
    // `{ mode: undefined }`, which reads as success everywhere downstream.
    return m ? { mode: m } : { err: T.label + " has no way to write the " + Tool.chanWord(chan) + " channel yet." };
  },
  // The legacy name of a point in the space, or null if it has none.
  modeOf(b){
    if (!b || !b.tool || b.tool === "none") return "none";
    if (b.target === "mask") return "mask";
    for (const m in Tool.MODES) {
      const p = Tool.MODES[m];
      if (p.target === "content" && p.tool === b.tool && p.chan === b.chan) return m;
    }
    return null;
  },
  // ...and the point a legacy name stands for, written onto `b`. `mask` and `none` leave the
  // channel alone on purpose — putting the mask brush down must put you back on the channel you
  // were working in, not on whichever one the enum happened to be written with.
  set(b, mode){
    const p = Tool.MODES[mode];
    if (!b || !p) return false;
    b.tool = p.tool;
    b.target = p.target;
    if (p.chan) b.chan = p.chan;
    return true;
  },
  // The channel a mode writes, as a layer would declare it: "color" for both colour tools, and null
  // for the mask brush (it writes whatever its layer writes) and for no tool at all.
  chanOf(mode){
    const p = Tool.MODES[mode];
    return p ? p.chan : null;
  },
};
// mode -> the surface map it writes, colour excluded: the two colour tools and the mask brush read
// and write the composite rather than a single unpacked map. Derived from MODES, so the table that
// used to be written out by hand cannot drift from the one above it.
const BRUSH_CHAN = {};
for (const m in Tool.MODES) {
  const p = Tool.MODES[m];
  if (p.target === "content" && p.chan && p.chan !== "color") BRUSH_CHAN[m] = p.chan;
}
/*==ENDTOOLS==*/
// `App.brush.mode` is the legacy view of the three axes, the way `L.type` is the legacy view of a
// layer's content. It is an accessor rather than a stored field so that the two cannot disagree:
// the axes are the truth, and every existing reader — prefs, the recorder, `BrushTools`' per-tool
// settings map, five tests — keeps working against a string.
//
// An unknown mode is IGNORED rather than stored. `brush.mode` is a saved preference, so a string
// from an older build (or a hand-edited settings file) reaches this setter, and the old code
// accepted any string deliberately: "a row that silently refuses a value is a row nothing can
// test". It is testable now for a better reason — `Tool.resolve` names every mode there is — and
// storing an unknown one would leave the three axes describing a tool that cannot be picked up.
Object.defineProperty(App.brush, "mode", {
  get(){ return Tool.modeOf(App.brush); },
  set(v){ Tool.set(App.brush, v); },
  enumerable: true, configurable: true,
});
