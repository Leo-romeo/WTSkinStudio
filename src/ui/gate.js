"use strict";
// ---------- Publishability gate (ROADMAP 3.31) ----------
// Anything the app can do that a PUBLISHED skin may not carry is off by default and says why, in one
// visual language everywhere: the control is disabled in the `.gated` style, and a small mark beside
// it names the rule and unlocks the control for a skin the user keeps to themselves. After the
// unlock the mark STAYS, lit — the failure this exists for is someone enabling a thing to test it,
// forgetting, and then doing hours of real work that WT Live will refuse.
//
// The rules are `export/validate.js`'s (`settex`, `size8k`, `protected`) and nothing here restates
// how they are checked; `bites` asks the same questions of the vehicle on screen that the validator
// asks of the finished plan, so a control is refused for exactly the reason the export would be.
// Unlocks live in `App.gateOpen` for the session only. One object, not five globals (CLAUDE.md §4).
const Gate = {
  // The sentence each rule shows. One copy: the tooltip, the status line and the slot row read it.
  WHY: {
    settex: "the .blk mode is wrong for this vehicle class — replace_tex on a ground vehicle breaks in-game decals, and set_tex does nothing on an aircraft",
    size8k: "8192 px is accepted only for rank VI+ aircraft and bombers; everything else caps at 4096",
    protected: "cockpit and engine-flame sheets must not be modified in a published skin",
  },
  // Whether each rule bites for the vehicle on screen. `settex` answers with the mode that is wrong
  // here (or null when the class is unknown), the other two with a boolean.
  bites: {
    settex(){
      const c = vehicleClass();
      return c === "tank" || c === "ship" ? "replace_tex" : c === "air" || c === "heli" ? "set_tex" : null;
    },
    size8k(){
      const on = (App.skinUnits || []).filter(u => u.on);
      const rank = on.length ? on[0].unit.rank || 0 : 0;
      return vehicleClass() !== "air" || rank < 6;
    },
    protected(slot){ return slotRole(slot) !== "exterior"; },
  },
  open(key){ return App.gateOpen.has(key); },
  toggle(key){ if (App.gateOpen.has(key)) App.gateOpen.delete(key); else App.gateOpen.add(key); },
  // A whole control: disabled in the shared style while locked. Returns whether it is open.
  control(el, key){
    const open = Gate.open(key);
    el.disabled = !open;
    el.classList.toggle("gated", !open);
    return open;
  },
  // Some of a <select>'s options. Locked ones stay listed — the user should see the value exists
  // and be able to read why it is off — and a select sitting on a locked value is put back to
  // `safe`. Returns true when that happened, so the caller can redraw what read the old value.
  options(sel, values, key, safe){
    const open = Gate.open(key);
    for (const op of sel.options) if (values.includes(op.value)) { op.disabled = !open; op.classList.toggle("gated", !open); }
    if (!open && values.includes(sel.value)) { sel.value = safe; return true; }
    return false;
  },
  // The mark. It holds no state of its own: `after` redraws the panel that placed it, and the next
  // draw builds a mark in the new state.
  mark(key, after){
    const m = document.createElement("span");
    const open = Gate.open(key);
    m.className = "gatemark" + (open ? " open" : "");
    m.dataset.gate = key;
    m.setAttribute("role", "button"); m.tabIndex = 0;
    m.title = (open ? "Enabled, but a published skin cannot carry this: " : "Off — a published skin cannot carry this: ") +
      Gate.WHY[key] + (open ? ". Click to turn it off again." : ". Click to enable it anyway, for a skin you keep to yourself.");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("aria-label", open ? "not publishable, enabled" : "not publishable");
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", "8"); c.setAttribute("cy", "8"); c.setAttribute("r", "6");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", "M3.8 3.8 12.2 12.2");
    svg.append(c, p); m.appendChild(svg);
    const flip = ev => {
      ev.stopPropagation(); ev.preventDefault();
      Gate.toggle(key);
      setStatus(Gate.open(key) ? "Enabled for this session — a published skin cannot carry this: " + Gate.WHY[key]
                               : "Off again — " + Gate.WHY[key], Gate.open(key) ? "err" : "ok");
      if (after) after();
    };
    m.onclick = flip;
    m.onkeydown = ev => { if (ev.key === "Enter" || ev.key === " ") flip(ev); };
    return m;
  },
  // Put one mark for `key` in `host`, replacing the one a previous draw left there.
  place(host, key, after, on = true){
    const old = host.querySelector('.gatemark[data-gate="' + key + '"]');
    if (old) old.remove();
    if (on) host.appendChild(Gate.mark(key, after));
  },
};
