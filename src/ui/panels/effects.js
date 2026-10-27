// ---------- An effect's rows (ROADMAP 4.50 (5)) ----------
// The Effect select, and the rows of the kind it names: the four numbers exactly as they always
// were, Levels' five, the Curves box, Colour balance's three ranges, a gradient map's stops (GradUI's
// own rows, handed the effect's record) and one number each for Threshold and Posterize. One binding
// over `Effect` (editor/effects.js), on the pattern §4 asks for, built by `LayerProps.effect`.
//
// Every edit REPLACES the record on the content in hand and on every linked sibling's (`put`), and
// every edit is one undo step: a select through `pushAction` with the record before and after, a
// slider through `bindUndoRange` — live on input, one step on release — and a curve point the same
// way by hand, so a drag never rebuilds the panel under the pointer.
const FxUI = {
  // Which part of a colour effect Levels and Curves are editing, and which tones Colour balance's
  // sliders move. The panel's state, not the record's: it survives a rebuild and a change of layer.
  sub: "rgb",
  range: "mids",
  SUBS: [["rgb", "all channels"], ["r", "red"], ["g", "green"], ["b", "blue"]],
  RANGES: [["shadows", "shadows"], ["mids", "midtones"], ["highs", "highlights"]],

  // ---- writing ----
  // Two rules ride along with every write (review of 4.50 (5), 2026-09-26):
  // - a channel's own Levels or Curves back at no change goes (`Effect.tidy`), so undoing a channel's
  //   first edit leaves the record as it was, not an identity the Channel select calls "adjusted";
  // - while an effect has a record, its four numbers are AT REST — in memory as in the file, which
  //   has always written them at rest beside an `fx` so an older build draws no stale hue shift.
  //   Left live they came back when the four numbers were chosen again, but only until a save and a
  //   reload, after which the same choice gave 0 / 100 / 100 / 100. `nums` is what they become when
  //   the record goes; `step` hands over the ones from before its change, which is how undo returns
  //   a hue shift that choosing Levels set to rest.
  put(P, next, nums){
    P.onChan((c, x) => {
      if (next) { c.fx = Effect.tidy(Effect.clone(next)); Object.assign(c, Effect.HSBC_REST); }
      else { delete c.fx; delete c._fxT; delete c._fxKey; if (nums) Object.assign(c, nums); }
      if (x._thumb) x._thumbRev = -1; else x._thumb = null;     // repainted in place by the list's tick (GradUI.put says why)
    });
  },
  // A change that is one undo step and rebuilds the rows: a select, a checkbox, a reset.
  step(P, desc, next){
    const C = P.C, was = C.fx ? Effect.clone(C.fx) : null;
    const nums = C.fx ? Object.assign({}, Effect.HSBC_REST) : { hue: C.hue, sat: C.sat, bright: C.bright, contrast: C.contrast };
    const apply = v => { FxUI.put(P, v, nums); refreshLayerList(); };
    pushAction(desc, () => apply(was), () => apply(next));
    apply(next);
  },
  // A slider over one number of the record: live on input, one undo step on release, the panel left
  // alone. `get` reads the number off the live record, `set` writes it into a clone.
  slider(P, row, get, set, desc, show){
    bindUndoRange(row.querySelector("input[type=range]"), () => get(P.C.fx), v => {
      const n = Effect.clone(P.C.fx);
      set(n, v);
      FxUI.put(P, n);
    }, desc, () => { if (show) row.querySelector(".val").textContent = show(P.C.fx); });
  },
  hint(P, text){
    const h = document.createElement("div");
    h.className = "hint"; h.style.margin = "0 0 4px"; h.textContent = text;
    P.el.appendChild(h);
  },
  button(row, label, title, fn){
    const b = document.createElement("button");
    b.textContent = label; b.title = title;
    b.style.cssText = "padding:1px 6px;font-size:11px";
    b.onclick = fn;
    row.appendChild(b);
  },

  // ---- the rows ----
  build(P){
    const { C, ch, mk } = P;
    const type = Effect.typeOf(C), known = !!Effect.kind(type);
    const kinds = Effect.KINDS.filter(k => ch === "color" || !k.colour || k.id === type);
    const r = mk(`<label title="What this layer does to everything beneath it on this channel. It stays live: change the kind or its numbers any time.">Effect</label>` +
      `<select style="flex:1">` + (known ? "" : `<option value="" selected>${escHtml(type)} — made by a newer version, draws nothing here</option>`) +
      kinds.map(k => `<option value="${k.id}"${k.id === type ? " selected" : ""}>${k.word}</option>`).join("") + `</select>`);
    r.querySelector("select").onchange = e => {
      const k = Effect.kind(e.target.value);
      if (k) FxUI.step(P, "effect: " + k.word, Effect.make(k.id));
    };
    if (known) FxUI.rows[type](P);
  },
  // The Channel select of Levels and Curves: on colour, or wherever a record already carries a
  // channel of its own (one moved off colour keeps it, and the rows have to be able to reach it).
  part(P){
    const fx = P.C.fx;
    if (P.ch !== "color" && !["r", "g", "b"].some(k => fx[k])) return "rgb";
    const sub = FxUI.SUBS.some(s => s[0] === FxUI.sub) ? FxUI.sub : "rgb";
    const r = P.mk(`<label title="Which channel the rows below edit. A channel's own setting is applied first, then the one for all channels.">Channel</label>` +
      `<select style="flex:1">${FxUI.SUBS.map(([k, w]) => `<option value="${k}"${k === sub ? " selected" : ""}>${w}${k !== "rgb" && fx[k] ? " (adjusted)" : ""}</option>`).join("")}</select>`);
    r.querySelector("select").onchange = e => { FxUI.sub = e.target.value; refreshLayerProps(); };
    return sub;
  },
  // Back to no change, for the part in hand: all channels to the identity, a channel to none of its own.
  reset(P, sub, what, fresh){
    const r = P.mk("");
    FxUI.button(r, "reset " + (sub === "rgb" ? "" : { r: "red", g: "green", b: "blue" }[sub] + " ") + what,
      sub === "rgb" ? "Back to no change for all channels" : "Remove this channel's own setting", () => {
        const n = Effect.clone(P.C.fx);
        if (sub === "rgb") n.rgb = fresh(); else delete n[sub];
        FxUI.step(P, "reset " + what, n);
      });
  },
  rows: {
    // The four numbers, exactly the rows an effect has always had.
    hsbc(P){
      const { C, mk, onChan } = P;
      const params = [["hue", -180, 180, "°"], ["sat", 0, 300, "%"], ["bright", 20, 250, "%"], ["contrast", 20, 250, "%"]];
      for (const [k, mn, mx, u] of params) {
        const r = mk(`<label>${k}</label><input type="range" min="${mn}" max="${mx}" value="${C[k]}"><span class="val">${C[k]}${u}</span>`);
        bindUndoRange(r.querySelector("input"), () => C[k], v => onChan(c => c[k] = v), "adjust " + k,
          () => r.querySelector(".val").textContent = C[k] + u);
      }
    },
    levels(P){
      const sub = FxUI.part(P);
      const L = fx => fx[sub] || Effect.lv();
      const set = k => (n, v) => { n[sub] = Object.assign(L(n), { [k]: v }); };
      const num = (k, label, tip) => {
        const v = L(P.C.fx)[k];
        const row = P.mk(`<label title="${tip}">${label}</label><input type="range" min="0" max="255" step="1" value="${v}"><span class="val">${v}</span>`);
        FxUI.slider(P, row, fx => L(fx)[k], set(k), "levels " + label.toLowerCase(), fx => L(fx)[k]);
      };
      num("inLo", "In black", "The input level that becomes black: everything darker clips to it");
      num("inHi", "In white", "The input level that becomes white: everything lighter clips to it");
      const g = L(P.C.fx).gamma;
      const rg = P.mk(`<label title="Bends the middle: above 1 lifts the midtones, below 1 sinks them, and black and white stay where they are">Gamma</label>` +
        `<input type="range" min="10" max="500" step="1" data-k="0.01" value="${Math.round(g * 100)}"><span class="val">${g.toFixed(2)}</span>`);
      FxUI.slider(P, rg, fx => Math.round(L(fx).gamma * 100), (n, v) => { n[sub] = Object.assign(L(n), { gamma: v / 100 }); }, "levels gamma", fx => L(fx).gamma.toFixed(2));
      num("outLo", "Out black", "What black becomes: raise it to lift the darkest value");
      num("outHi", "Out white", "What white becomes: lower it to cap the lightest value");
      FxUI.reset(P, sub, "levels", Effect.lv);
      FxUI.hint(P, P.ch === "color" ? "Squeeze the range, lift or cap it, bend the middle. A channel's own levels come first, then all channels'."
        : "The everyday tool for a roughness or metalness map: squeeze its range, lift or cap it, bend the middle.");
    },
    curves(P){
      const sub = FxUI.part(P);
      FxUI.curveBox(P, sub);
      FxUI.reset(P, sub, "curve", Effect.line);
      FxUI.hint(P, "Click to add a point and drag it. Drag a point out of the box, or double-click it, to remove it. The dashed line is no change.");
    },
    balance(P){
      const rg = FxUI.RANGES.some(x => x[0] === FxUI.range) ? FxUI.range : "mids";
      const word = FxUI.RANGES.find(x => x[0] === rg)[1];
      const r = P.mk(`<label title="Which tones the three sliders below shift. The ranges blend into one another, so a midtone shift fades out toward black and white.">Tones</label>` +
        `<select style="flex:1">${FxUI.RANGES.map(([k, w]) => `<option value="${k}"${k === rg ? " selected" : ""}>${w}${P.C.fx[k].some(v => v) ? " (shifted)" : ""}</option>`).join("")}</select>`);
      r.querySelector("select").onchange = e => { FxUI.range = e.target.value; refreshLayerProps(); };
      [["Cyan–Red", "cyan", "red"], ["Magenta–Green", "magenta", "green"], ["Yellow–Blue", "yellow", "blue"]].forEach(([label, lo, hi], c) => {
        const v = P.C.fx[rg][c];
        const row = P.mk(`<label title="Shift the ${word} toward ${lo} (left) or ${hi} (right)">${label}</label><input type="range" min="-100" max="100" step="1" value="${v}"><span class="val">${v}</span>`);
        FxUI.slider(P, row, fx => fx[rg][c], (n, v) => { n[rg][c] = v; }, "colour balance " + label, fx => fx[rg][c]);
      });
      const kr = P.mk(`<label title="Put every texel's tone back where it was, so the balance changes its colour and not its brightness">Keep luminosity</label>`);
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = P.C.fx.keepLum !== false;
      cb.onchange = () => { const n = Effect.clone(P.C.fx); n.keepLum = cb.checked; FxUI.step(P, cb.checked ? "keep luminosity" : "let luminosity move", n); };
      kr.appendChild(cb);
    },
    // The stops are GradUI's own rows, handed this effect's record in place of a fill's gradient.
    gradmap(P){
      const withStops = n => { const f = Effect.clone(P.C.fx); f.stops = n.stops; return f; };
      GradUI.stopRows(P, {
        get: () => ({ stops: P.C.fx.stops }),
        put: n => FxUI.put(P, withStops(n)),
        step: (desc, n) => FxUI.step(P, desc, withStops(n)),
        one: "A gradient map needs at least one stop — pick another kind of effect above instead",
        posTip: "Which tone this stop is: 0 % is what black becomes, 100 % what white becomes.",
        hint: "Every tone becomes the colour at its place along the stops: black's at the left, white's at the right. A stop at 0 % opacity leaves those tones as they were.",
      });
    },
    invert(P){
      FxUI.hint(P, "Every value becomes its opposite — 255 minus itself — on each channel. Fade it with the layer's opacity.");
    },
    threshold(P){
      const v = P.C.fx.level;
      const row = P.mk(`<label title="The tone that divides black from white">Level</label><input type="range" min="0" max="255" step="1" value="${v}"><span class="val">${v}</span>`);
      FxUI.slider(P, row, fx => fx.level, (n, v) => { n.level = v; }, "threshold level", fx => fx.level);
      FxUI.hint(P, "Every texel whose tone is at or above the level becomes white, the rest black: a hard mask out of what lies beneath.");
    },
    posterize(P){
      const v = P.C.fx.levels;
      const row = P.mk(`<label title="How many values each channel keeps">Levels</label><input type="range" min="2" max="32" step="1" value="${v}"><span class="val">${v}</span>`);
      FxUI.slider(P, row, fx => fx.levels, (n, v) => { n.levels = v; }, "posterize levels", fx => fx.levels);
      FxUI.hint(P, "Each channel keeps only this many evenly spaced values: flat bands, the way a stencilled camouflage reads.");
    },
    // ROADMAP 4.50 (5), the second step. Each radius is in texels of the sheet it is on.
    blur(P){
      const v = P.C.fx.radius;
      const row = P.mk(`<label title="How far each texel is averaged with its neighbours, in texels of this sheet">Radius</label><input type="range" min="1" max="${Effect.MAX_R}" step="1" value="${v}"><span class="val">${v}</span>`);
      FxUI.slider(P, row, fx => fx.radius, (n, v) => { n.radius = v; }, "blur radius", fx => fx.radius);
      FxUI.hint(P, "Softens everything beneath it on this channel — a Gaussian blur. Confine it with a mask or a Limit, fade it with the layer's opacity.");
    },
    sharpen(P){
      const r = P.C.fx.radius, a = P.C.fx.amount;
      const rr = P.mk(`<label title="How wide the detail it brings out is, in texels of this sheet">Radius</label><input type="range" min="1" max="${Effect.MAX_R}" step="1" value="${r}"><span class="val">${r}</span>`);
      FxUI.slider(P, rr, fx => fx.radius, (n, v) => { n.radius = v; }, "sharpen radius", fx => fx.radius);
      const ar = P.mk(`<label title="How strongly: at 100 % each texel moves as far again from its blurred neighbourhood as it already stands">Amount</label><input type="range" min="0" max="500" step="5" value="${a}"><span class="val">${a}%</span>`);
      FxUI.slider(P, ar, fx => fx.amount, (n, v) => { n.amount = v; }, "sharpen amount", fx => fx.amount + "%");
      FxUI.hint(P, "An unsharp mask: each texel pushed away from the blur of its neighbourhood, so edges and fine detail stand out.");
    },
    noise(P){
      const fx = P.C.fx;
      const ar = P.mk(`<label title="How far each texel can move, in levels (out of 255), up or down">Amount</label><input type="range" min="0" max="128" step="1" value="${fx.amount}"><span class="val">${fx.amount}</span>`);
      FxUI.slider(P, ar, f => f.amount, (n, v) => { n.amount = v; }, "noise amount", f => f.amount);
      const r = P.mk(`<label title="The same seed is the same noise every time">Seed</label><span class="val" style="margin-left:0">${fx.seed}</span>`);
      FxUI.button(r, "new", "Roll a different noise", () => { const n = Effect.clone(P.C.fx); n.seed = (Math.random() * 2147483647) | 0; FxUI.step(P, "new noise seed", n); });
      if (P.ch === "color") {
        const mr = P.mk(`<label title="The same shift on red, green and blue — grain. Off: each channel its own, coloured speckle">Mono</label>`);
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.checked = fx.mono !== false;
        cb.onchange = () => { const n = Effect.clone(P.C.fx); n.mono = cb.checked; FxUI.step(P, cb.checked ? "mono noise" : "colour noise", n); };
        mr.appendChild(cb);
      }
      FxUI.hint(P, "Grain over everything beneath it: each texel moved up or down at random, the same noise wherever the sheet is redrawn.");
    },
  },

  // ---- the Curves box ----
  // The curve is drawn from the very table the composite uses, over a quarter grid and the dashed
  // line of no change. A click adds a point and takes it; a point moves no further than one step
  // short of its neighbours (`Effect.curveMove`); one dragged well out of the box goes when it is
  // let go, as in Photoshop, and so does one double-clicked. Live while dragging, one undo step on
  // release, and the panel is not rebuilt under the pointer.
  curveBox(P, sub){
    const cv = document.createElement("canvas");
    cv.width = cv.height = 256;
    cv.style.cssText = "display:block;width:100%;max-width:220px;aspect-ratio:1;margin:0 auto 6px;border:1px solid var(--border);border-radius:3px;cursor:crosshair;touch-action:none";
    P.el.appendChild(cv);
    const pts = () => P.C.fx[sub] || Effect.line();
    const write = v => { const n = Effect.clone(P.C.fx); n[sub] = v.map(p => p.slice()); FxUI.put(P, n); };
    const draw = () => FxUI.drawCurve(cv, pts(), sub);
    const at = e => {
      const b = cv.getBoundingClientRect(), w = b.width || 1, h = b.height || 1, M = 16;
      return { x: (e.clientX - b.left) / w * 255, y: (1 - (e.clientY - b.top) / h) * 255, tol: 8 / w * 255,
               out: e.clientX < b.left - M || e.clientX > b.right + M || e.clientY < b.top - M || e.clientY > b.bottom + M };
    };
    const commit = (desc, before, after) => {
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      const set = v => { write(v); refreshLayerList(); };
      pushAction(desc, () => set(before), () => set(after));
    };
    let drag = null;
    // The last two presses, oldest first. A double-click arrives as press, release, press, release,
    // dblclick: by then its first press has put a point down wherever it found none, and the second
    // has taken hold of it — so removing "the point double-clicked" undid that click as a second
    // step, and the curve came out as it went in with two undo steps and two composites to show for
    // it (review of 4.50 (5), 2026-09-26). A double-click removes only a point that was there BEFORE
    // it; on empty space it is a click, and the point it put down stays, in one step.
    let presses = [null, null];
    cv.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      const p = at(e), before = pts().map(q => q.slice());
      let i = Effect.curveHit(before, p.x, p.y, p.tol), now = before;
      presses = [presses[1], { added: i < 0 }];
      if (i < 0) { const a = Effect.curveAdd(before, p.x, p.y); now = a.pts; i = a.i; write(now); draw(); }
      drag = { i, before, pts: now, out: false };
      cv.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    cv.addEventListener("pointermove", e => {
      if (!drag) return;
      const p = at(e);
      drag.pts = Effect.curveMove(drag.pts, drag.i, p.x, p.y);
      drag.out = p.out && drag.pts.length > 2;
      write(drag.out ? Effect.curveDrop(drag.pts, drag.i) : drag.pts);
      draw();
    });
    const end = () => {
      if (!drag) return;
      const d = drag, after = d.out ? Effect.curveDrop(d.pts, d.i) : d.pts;
      drag = null;
      write(after); draw();
      commit(d.out ? "remove curve point" : "curve", d.before, after);
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("dblclick", e => {
      if (presses[0] && presses[0].added) return;             // this double-click put the point there: it was a click
      const p = at(e), before = pts().map(q => q.slice()), i = Effect.curveHit(before, p.x, p.y, p.tol);
      if (i < 0 || before.length <= 2) return;
      const after = Effect.curveDrop(before, i);
      write(after); draw();
      commit("remove curve point", before, after);
    });
    draw();
  },
  drawCurve(cv, pts, sub){
    const g = cv.getContext("2d"), S = cv.width, css = getComputedStyle(cv);
    const v = (k, d) => (css.getPropertyValue(k) || "").trim() || d;
    g.clearRect(0, 0, S, S);
    g.fillStyle = v("--panel2", "#242832"); g.fillRect(0, 0, S, S);
    g.strokeStyle = v("--border", "#333845"); g.lineWidth = 1;
    g.beginPath();
    for (let k = 1; k < 4; k++) { const q = Math.round(k * S / 4) + .5; g.moveTo(q, 0); g.lineTo(q, S); g.moveTo(0, q); g.lineTo(S, q); }
    g.stroke();
    g.setLineDash([4, 4]); g.strokeStyle = v("--muted", "#8b91a0");
    g.beginPath(); g.moveTo(0, S); g.lineTo(S, 0); g.stroke();
    g.setLineDash([]);
    const t = Effect.curve(pts), X = x => x / 255 * (S - 1) + .5, Y = y => (255 - y) / 255 * (S - 1) + .5;
    g.strokeStyle = sub === "r" ? v("--danger", "#e05555") : sub === "g" ? v("--ok", "#4fbf7a") : sub === "b" ? v("--accent", "#4f8ff7") : v("--text", "#d6d9e0");
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x < 256; x++) { if (x) g.lineTo(X(x), Y(t[x])); else g.moveTo(X(x), Y(t[x])); }
    g.stroke();
    g.fillStyle = v("--accent", "#4f8ff7");
    for (const p of pts) g.fillRect(Math.round(X(p[0])) - 4, Math.round(Y(p[1])) - 4, 8, 8);
  },
};
