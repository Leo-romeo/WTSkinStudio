
// ---------- Long-operation progress (bar + cancel) ----------
// Scanning an install and extracting a model both take many seconds; without this the app
// just looks frozen. Every long loop calls progress()/progTick() and checks progCancelled().
// `gen` lets a long background job (the UserSkins scan) tell whether the bar it started is
// still its own before ending it — otherwise it wipes the bar of whatever the user kicked off
// in the meantime.
const Prog = { active: false, cancelled: false, label: "", frac: -1, lastPaint: 0, gen: 0 };
// `frac`, when given, is where a job that was already running when its bar came up has got to —
// a fill evaluation takes the bar only at 200 ms, by when some of its bands may have landed.
function progBegin(label, cancellable, frac){
  Prog.active = true; Prog.cancelled = false; Prog.label = label; Prog.frac = frac >= 0 ? frac : -1; Prog.gen++;
  $("progWrap").classList.add("on");
  $("progCancel").style.display = cancellable ? "" : "none";
  progPaint(true);
}
function progress(label, frac){
  if (!Prog.active) return;
  if (label != null) Prog.label = label;
  if (frac != null) Prog.frac = frac;
  progPaint(false);
}
function progPaint(force){
  const now = performance.now();
  if (!force && now - Prog.lastPaint < 60) return;
  Prog.lastPaint = now;
  $("progLabel").textContent = $("progLabel").title = Prog.label;   // the bar leaves it half the row; hover has the rest
  const fill = $("progFill");
  if (Prog.frac < 0) { fill.classList.add("indet"); $("progPct").textContent = ""; }
  else {
    fill.classList.remove("indet");
    const pct = Math.max(0, Math.min(100, Prog.frac * 100));
    fill.style.width = pct.toFixed(1) + "%";
    $("progPct").textContent = pct.toFixed(0) + "%";
  }
}
function progEnd(){ Prog.active = false; $("progWrap").classList.remove("on"); $("progFill").style.width = "0%"; }
function progCancelled(){ return Prog.cancelled; }
$("progCancel").onclick = () => { Prog.cancelled = true; progress("Cancelling…"); };
// Yield to the browser so the bar actually repaints mid-loop.
let lastYield = 0;
async function progTick(force){
  const now = performance.now();
  if (!force && now - lastYield < 40) return;
  lastYield = now;
  await new Promise(r => setTimeout(r, 0));
}
class Cancelled extends Error { constructor(){ super("cancelled"); this.name = "Cancelled"; } }
function throwIfCancelled(){ if (Prog.cancelled) throw new Cancelled(); }

// ---------- Sidebar tabs ----------
function showTab(name){
  if (name === "weapons") {
    setTimeout(() => { try { refreshWeaponPanel(); } catch (e) { console.warn(e); } }, 0);
    // Frame the camera for the job (ROADMAP 4.38): the loadout screen's own view, from the front
    // and a little below. Only on an actual switch, and only with a model to frame — a click on
    // the tab that is already open must not move a view the user has lined up.
    if (App.leftTab !== name && App.geomData) Framing.weapons(450);
  }
  for (const b of $("leftTabs").children) b.classList.toggle("active", b.dataset.tab === name);
  for (const p of document.querySelectorAll("#leftbar .tabpage")) p.classList.toggle("active", p.id === "tab" + name[0].toUpperCase() + name.slice(1));
  App.leftTab = name;
}
for (const b of $("leftTabs").children) b.onclick = () => showTab(b.dataset.tab);
function updateTabCounts(){
  const nSlots = App.slots ? [...App.slots.values()].filter(s => !s.missing).length : 0;
  const nParts = App.meshes ? App.meshes.size : 0;
  $("tabCntTex").textContent = nSlots ? nSlots : "";
  $("tabCntParts").textContent = nParts ? nParts : "";
  const w = $("tabCntWeapons");
  if (w) w.textContent = App.weaponsLoaded && App.weaponsLoaded.size ? App.weaponsLoaded.size : "";
}
function mkCanvas(w, h){ const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
// NOT willReadFrequently. That hint pins a canvas to a CPU-backed surface, and every texture
// sheet in this app is both written and used as a `drawImage` source — the 2-D view, the
// compositor and the GPU upload all read from one. Measured on 8192²: with the hint, one
// `drawImage` from a sheet that had just been touched cost 218 ms (89 ms even for a 256-px
// region), because the whole 268 MB surface has to cross to the GPU again; without it, 7.8 ms.
// The hint bought nothing on the other side either — a 256² `getImageData` was 0.07 ms and a
// full-sheet read 120 ms with it and without it. This one flag was most of "editing a 4K or 8K
// texture is not responsive".
function ctx2d(c){ return c.getContext("2d"); }

