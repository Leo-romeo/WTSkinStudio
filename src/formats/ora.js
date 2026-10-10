/*==ORA==*/
"use strict";
// ---------- OpenRaster: a layer stack as a zip of PNGs and one XML file (ROADMAP 4.50 (16)) ----------
// The layered format Krita, GIMP and MyPaint all open and write, so a skin's stack can go to the
// editor a skinner already works in and come back. This file is only the TEXT half — `stack.xml` in
// and out, and the blend-mode names — so it has no DOM, no canvas and no zip, and a test can lift it
// into Node. The pixels and the zip are `editor/interchange.js`.
//
// What the format says, as this reader and writer hold it (the public OpenRaster specification; not
// re-fetched in the session that wrote this — nothing in it had download approval — so the points a
// real Krita or GIMP file could still contradict are listed in ROADMAP_DONE 4.50p):
//   * the zip's FIRST entry is `mimetype`, stored uncompressed, holding `image/openraster` — the
//     same trick ODF uses, so a reader can recognise the file from byte 30 without unzipping it;
//   * `stack.xml` is `<image w h>` holding one root `<stack>`; a `<stack>` holds `<layer>`s and
//     nested `<stack>`s, and **the first child is the TOPMOST** — the reverse of `slot.layers`,
//     which runs bottom first. The reversal lives here and nowhere else: `write` takes a list bottom
//     first and `parse` hands one back bottom first, so no caller ever sees the file's order;
//   * a `<layer>` names a PNG inside the zip (`src`) and places it at integer `x`, `y`; a writer may
//     crop a layer to what it covers (Krita does), so a reader must honour the offset. A `<stack>`'s
//     own `x`, `y` are added to its children's;
//   * `opacity` 0…1 (default 1), `visibility` "visible" | "hidden" (default visible),
//     `composite-op` a W3C Compositing name with an `svg:` prefix (default `svg:src-over`), and on a
//     `<stack>`, `isolation`: "isolate" or "auto". A stack that is "auto", `svg:src-over` and fully
//     opaque is not isolated at all — its children blend with what is under the stack — which is
//     what Krita writes for a pass-through group, and exactly the app's "pass through";
//   * `mergedimage.png` (the flattened picture) and `Thumbnails/thumbnail.png` (at most 256 px) sit
//     beside the stack.
const Ora = {
  MIME: "image/openraster",
  VERSION: "0.0.5",
  // The separable and non-separable blend modes of the W3C Compositing and Blending spec. ORA names
  // them `svg:<name>` and the canvas 2-D API names them `<name>` — the same formulas under the same
  // names, which is why a layer's blend crosses in both directions with no table of its own.
  SAME: ["multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light",
         "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"],
  // ---- blend names, both ways ----
  // The app's blend (a canvas composite operation, or "normal") as a composite-op. `svg:plus` is
  // canvas's `lighter`. Null for a blend the format has no name for — the caller says so.
  opOf(blend){
    if (!blend || blend === "normal" || blend === "pass through") return "svg:src-over";
    if (blend === "lighter") return "svg:plus";
    return Ora.SAME.includes(blend) ? "svg:" + blend : null;
  },
  // A composite-op as the app's blend. `lost` is set for anything the compositor cannot reproduce:
  // the other Porter-Duff operators (`svg:dst-out` is Krita's erase mode, `svg:src-atop` its
  // inherit-alpha) change COVERAGE rather than colour, and would punch through the albedo, which is
  // opaque by construction; any other program's own mode (`krita:…`) has no formula here at all.
  blendOf(op){
    const v = String(op || "svg:src-over").trim().toLowerCase();
    if (v === "svg:src-over") return { blend: "normal" };
    if (v === "svg:plus") return { blend: "lighter" };
    if (v.startsWith("svg:") && Ora.SAME.includes(v.slice(4))) return { blend: v.slice(4) };
    return { blend: "normal", lost: v };
  },

  // ---- out ----
  // `doc` = { w, h, children } with every list BOTTOM FIRST, a node being
  //   { kind: "layer", name, src, x, y, opacity, visible, op }   or
  //   { kind: "stack", name, opacity, visible, op, isolation, children }.
  write(doc){
    const out = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<image version="' + Ora.VERSION + '" w="' + (doc.w | 0) + '" h="' + (doc.h | 0) + '" xres="72" yres="72">', " <stack>"];
    const put = (list, pad) => {
      for (let i = list.length - 1; i >= 0; i--) {             // the topmost first, as the file lists it
        const n = list[i];
        const a = 'name="' + Ora.esc(n.name) + '" opacity="' + Ora.num(n.opacity) + '" visibility="' +
          (n.visible === false ? "hidden" : "visible") + '" composite-op="' + Ora.esc(n.op || "svg:src-over") + '"';
        if (n.kind === "stack") {
          out.push(pad + "<stack " + a + ' isolation="' + (n.isolation === "auto" ? "auto" : "isolate") + '">');
          put(n.children || [], pad + " ");
          out.push(pad + "</stack>");
        } else out.push(pad + "<layer " + a + ' src="' + Ora.esc(n.src) + '" x="' + (n.x | 0) + '" y="' + (n.y | 0) + '"/>');
      }
    };
    put(doc.children || [], "  ");
    out.push(" </stack>", "</image>", "");
    return out.join("\n");
  },
  // An opacity as the file writes it: enough digits to come back as the same slider value, none of
  // the float noise (0.30000000000000004) that would make a diff of two exports unreadable.
  num(v){ const n = Math.max(0, Math.min(1, +v)); return String(isFinite(n) ? Math.round(n * 1e6) / 1e6 : 1); },
  // Attribute text. A control character is not allowed in XML 1.0 at all, and a tab or line break
  // inside an attribute is folded to a space by every reader unless it is written as a reference.
  esc(s){
    return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
      .replace(/[\t\n\r]/g, c => "&#" + c.charCodeAt(0) + ";").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
  },

  // ---- in ----
  // The stack as `write` takes it — bottom first, offsets already summed down the tree — plus the
  // names of any elements this reader skipped, for the caller's report.
  parse(text){
    const top = Ora.xml(text).find(e => e.tag === "image");
    if (!top) throw new Error("stack.xml has no <image> element, so it is not an OpenRaster layer stack");
    const w = Math.round(parseFloat(top.attrs.w)), h = Math.round(parseFloat(top.attrs.h));
    if (!(w > 0 && h > 0)) throw new Error("stack.xml gives no image size (w=\"" + (top.attrs.w || "") + "\", h=\"" + (top.attrs.h || "") + "\")");
    const root = top.kids.find(e => e.tag === "stack");
    if (!root) throw new Error("stack.xml has no layer stack in it");
    const skipped = [];
    const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
    const kids = (el, ox, oy) => {
      const list = [];
      for (const e of el.kids) {
        if (e.tag !== "layer" && e.tag !== "stack") { skipped.push(e.tag); continue; }
        const x = ox + Math.round(num(e.attrs.x, 0)), y = oy + Math.round(num(e.attrs.y, 0));
        const n = { kind: e.tag, name: e.attrs.name == null ? null : e.attrs.name,
                    opacity: Math.max(0, Math.min(1, num(e.attrs.opacity, 1))),
                    visible: e.attrs.visibility !== "hidden", op: e.attrs["composite-op"] || "svg:src-over" };
        if (e.tag === "stack") { n.isolation = e.attrs.isolation === "auto" ? "auto" : "isolate"; n.children = kids(e, x, y); }
        else { n.src = e.attrs.src || ""; n.x = x; n.y = y; }
        list.push(n);
      }
      return list.reverse();                                   // the file lists the topmost first
    };
    return { w, h, version: top.attrs.version || null, children: kids(root, 0, 0), skipped };
  },
  // Just enough XML for a stack.xml: elements, attributes in either quote, the five named entities
  // and character references. The prolog, comments, a DOCTYPE and CDATA are stepped over and text is
  // ignored — a stack.xml carries none that means anything. Not DOMParser, because this layer has no
  // DOM (CLAUDE.md §2) and the test lifts it into Node; `t101` holds it to DOMParser's reading of
  // the same text. Returns the top-level elements, each { tag, attrs, kids }.
  xml(text){
    const s = String(text);
    const NAME = /[A-Za-z_][\w.:-]*/y, ATTR = /\s*([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y, END = /\s*(\/?)>/y;
    const root = { tag: "", attrs: {}, kids: [] }, open = [root];
    let i = 0;
    const fail = why => { throw new Error("stack.xml is not readable XML: " + why + " (at character " + i + ")"); };
    const skip = (to, what) => { const e = s.indexOf(to, i); if (e < 0) fail("an unclosed " + what); i = e + to.length; };
    while ((i = s.indexOf("<", i)) >= 0) {
      if (s.startsWith("<?", i)) { skip("?>", "<?"); continue; }
      if (s.startsWith("<!--", i)) { i += 4; skip("-->", "comment"); continue; }
      if (s.startsWith("<![CDATA[", i)) { skip("]]>", "CDATA section"); continue; }
      if (s.startsWith("<!", i)) { skip(">", "declaration"); continue; }
      if (s[i + 1] === "/") {
        const e = s.indexOf(">", i);
        if (e < 0) fail("an unclosed end tag");
        const name = s.slice(i + 2, e).trim(), el = open.pop();
        if (open.length === 0 || el.tag !== name) fail("</" + name + "> where </" + el.tag + "> was expected");
        i = e + 1;
        continue;
      }
      NAME.lastIndex = i + 1;
      const m = NAME.exec(s);
      if (!m) fail("a '<' that starts no element");
      const el = { tag: m[0], attrs: {}, kids: [] };
      i = NAME.lastIndex;
      for (;;) {
        END.lastIndex = i;
        const e = END.exec(s);
        if (e) { i = END.lastIndex; open[open.length - 1].kids.push(el); if (!e[1]) open.push(el); break; }
        ATTR.lastIndex = i;
        const a = ATTR.exec(s);
        if (!a) fail("a malformed attribute in <" + el.tag + ">");
        el.attrs[a[1]] = Ora.unesc(a[2] != null ? a[2] : a[3]);
        i = ATTR.lastIndex;
      }
    }
    if (open.length !== 1) fail("<" + open[open.length - 1].tag + "> is never closed");
    return root.kids;
  },
  unesc(v){
    return v.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (m, e) => {
      if (e[0] !== "#") return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[e];
      const n = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "�";
    });
  },
};
/*==ENDORA==*/
