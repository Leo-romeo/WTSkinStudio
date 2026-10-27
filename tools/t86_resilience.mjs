// One unreadable piece costs that piece, not the vehicle (ROADMAP 4.4).
//
// WHY THIS EXISTS. Game-file parsing WILL break when Gaijin ships an engine update (CLAUDE.md §0.3),
// and the question is what the user meets when it does. Before this, one vertex buffer in a format
// the reader did not know threw out of `buildDynModelGeometry` and took the whole vehicle with it —
// "Model load failed: unsupported vertex format 7-40", nothing on screen, and no word about the
// manual OBJ/DDS route that still works. A skeleton that would not parse did the same. A track
// preview that threw went to console.warn and nowhere else, and a baked animation that would not
// read said so in a status line the very next line of the loader overwrote.
//
// What is held, in the real page with the real parsers:
//
//   * a DynModel whose second vertex buffer is in an unknown format (built here, byte by byte, as
//     the MatVData reader reads it) gives back the first part WITH its face and the second part
//     with none — and a `dropped` entry naming the part and the reason;
//   * a model with no readable buffer at all is still an error, and says which format stopped it;
//   * `extractVehicleGeometry` with a skeleton and an animation clip that are garbage still returns
//     the geometry, unplaced, and names both losses;
//   * `loadVehicleModel` puts the vehicle on screen and ends on ONE sentence that says what was
//     left out, why, and that Add files… with an .obj and its .dds still works — as a warning, not
//     as "loaded ✓"; the track preview's failure is in it too;
//   * and a vehicle that cannot be read at all says the same about the manual route.
//
// Usage: node tools/t86_resilience.mjs [--keep] [--chrome <path>]
import { findBrowser, evalInPage, pageExpr, makeReport } from "./headless.mjs";

const argv = process.argv.slice(2);
const R = makeReport();
const browser = findBrowser(argv.includes("--chrome") ? argv[argv.indexOf("--chrome") + 1] : null);
if (!browser) { console.log("SKIP: no Chrome or Edge found. Pass --chrome <path> or set CHROME."); process.exit(0); }

const BODY = `async function(){
  var out = {};
  // ---- a MatVData with two vertex buffers: format 1 (known: 12-byte float xyz) and 99 (unknown) ----
  // Laid out exactly as MatVData.compute / getVertexData read it: a 16-byte head, the table's
  // offset and count, one 0x20-byte record per buffer, then each buffer's vertices and indices.
  // An entry is a format with a 12-byte float xyz layout, or [5, 24]: format 5 at stride 24, which the
  // reader lays out as UV (2 × i16), position (3 × i16 / 32768) and 14 bytes it skips.
  var mkMvd = function(formats){
    var n = formats.length, verts = 3, iSz = 6, head = 24, tab = n * 0x20;
    var strideOf = function(f){ return Array.isArray(f) ? f[1] : 12; };
    var size = head + tab;
    for (var q = 0; q < n; q++) size += verts * strideOf(formats[q]) + iSz;
    var buf = new ArrayBuffer(size), dv = new DataView(buf);
    dv.setUint32(16, head, true); dv.setUint32(20, n, true);
    var b = head + tab;
    for (var i = 0; i < n; i++) {
      var o = head + i * 0x20, fmt = Array.isArray(formats[i]) ? formats[i][0] : formats[i], stride = strideOf(formats[i]);
      dv.setUint32(o, verts, true); dv.setUint8(o + 4, stride);           // vCnt, vStride
      dv.setUint8(o + 5, 0); dv.setUint8(o + 6, 0); dv.setUint8(o + 7, 0); // iPackedSz = 0: plain u16 indices
      dv.setUint32(o + 8, iSz, true);                                       // iSz: one triangle
      dv.setUint32(o + 20, fmt, true);                                      // storageFormat
      var P = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
      for (var v = 0; v < 3; v++) for (var k = 0; k < 3; k++) {
        if (stride === 24) dv.setInt16(b + v * 24 + 4 + k * 2, Math.round((P[v][k] + i * .1) * 8000), true);
        else dv.setFloat32(b + v * stride + k * 4, P[v][k] + i * 10, true);
      }
      var ib = b + verts * stride;
      dv.setUint16(ib, 0, true); dv.setUint16(ib + 2, 1, true); dv.setUint16(ib + 4, 2, true);
      b = ib + iSz;
    }
    return new MatVData(new Uint8Array(buf), 0);
  };
  var mkDm = function(formats){
    var names = formats.map(function(f, i){ return ["hull", "gun", "flap", "net"][i]; });
    return { name: "t86", mvd: mkMvd(formats), bpC254: [0, 0, 0, 0], bpC255: [1, 1, 1, 1], skeleton: null,
      nodeNames: names, skinNodes: new Map(names.map(function(n, i){ return [i, i]; })),
      lods: [{ rigids: formats.map(function(f, i){ return { nodeId: i }; }),
               shaderMesh: formats.map(function(f, i){ return { elems: [{ vdOrderIndex: 0, vData: i, mat: 0, baseVertex: 0, startI: 0, numFace: 1 }] }; }) }] };
  };
  var faces = function(o){ var n = 0; o.groups.forEach(function(g){ n += g.faces.length; }); return n; };

  // ---- 1. one buffer in an unknown format costs its part, not the model ----
  try {
    var g1 = buildDynModelGeometry(mkDm([1, 99]), 0);
    out.partial = { objects: g1.objects.map(function(o){ return o.name + ":" + faces(o); }).join(" "),
                    verts: g1.verts.length, dropped: g1.dropped };
  } catch (e) { out.partial = { threw: String(e.message || e) }; }
  // the control: both known, nothing dropped
  var g0 = buildDynModelGeometry(mkDm([1, 1]), 0);
  out.control = { objects: g0.objects.map(function(o){ return o.name + ":" + faces(o); }).join(" "), dropped: g0.dropped };
  // ---- 2. nothing readable at all is still an error, and names the format ----
  try { buildDynModelGeometry(mkDm([98, 99]), 0); out.none = { threw: null }; }
  catch (e) { out.none = { threw: String(e.message || e) }; }
  // ---- 2b. format 5 marks parts only where it is the MINORITY of the model (2026-09-24) ----
  // A net on a tank is 7.9 % of the Leopard; a whole ship is format 5, and hiding what it marks
  // loaded USS Fletcher as an empty scene.
  var skinnedOf = function(g){ return g.objects.map(function(o){ return !!o.skinned; }).join(","); };
  var gMin = buildDynModelGeometry(mkDm([1, 1, 1, [5, 24]]), 0);
  var gMaj = buildDynModelGeometry(mkDm([[5, 24], [5, 24], 1]), 0);
  var gAll = buildDynModelGeometry(mkDm([[5, 24], [5, 24]]), 0);
  out.f5 = { minority: skinnedOf(gMin), majority: skinnedOf(gMaj), all: skinnedOf(gAll),
             read: gAll.verts.length === 6 && gAll.objects.every(function(o){ return faces(o) === 1; }) };
  // ...and a resource with no vertex data of its own says that, not "reading 'compute' of null"
  try { var nm = mkDm([1]); nm.mvd = null; buildDynModelGeometry(nm, 0); out.noMvd = null; }
  catch (e) { out.noMvd = String(e.message || e); }

  // ---- 3. extractVehicleGeometry: garbage skeleton and garbage clip, geometry still comes back ----
  var real = { idx: ensureGrpIndex, read: readGrpResource, dyn: loadDynModelBytes };
  try {
    ensureGrpIndex = async function(){ return { dyn: new Map([["t86", "d"]]), skel: new Map([["t86_skeleton", "s"]]), anim: new Map([["t86_anim", "a"]]) }; };
    readGrpResource = async function(ref){ return new Uint8Array([1, 2, 3, 4]); };
    loadDynModelBytes = async function(){ return mkDm([1, 99]); };
    var gx = await extractVehicleGeometry("t86");
    out.extract = { skeleton: gx.skeleton, a2d: gx.a2d, faces: gx.objects.map(faces).join(","),
                    pieces: gx.dropped.map(function(d){ return d.piece; }) };
    // a resource that does not parse at all: an error in words, not the engine's DataView message
    loadDynModelBytes = async function(){ throw new RangeError("Offset is outside the bounds of the DataView"); };
    try { await extractVehicleGeometry("t86"); out.unparsed = null; } catch (e) { out.unparsed = String(e.message || e); }
  } catch (e) { out.extract = { threw: String(e.message || e) }; }
  finally { ensureGrpIndex = real.idx; readGrpResource = real.read; loadDynModelBytes = real.dyn; }

  // ---- 4. loadVehicleModel: on screen, and one sentence about what was left out ----
  var realX = extractVehicleGeometry, realTex = loadVehicleTextures, realTracks = buildTrackGeometry;
  var say = function(){ return { text: $("status").textContent, cls: $("status").className }; };
  try {
    extractVehicleGeometry = async function(){
      var g = buildDynModelGeometry(mkDm([1, 99]), 0);
      g.skeleton = null; g.a2d = null;
      g.dropped.push({ piece: "the skeleton", why: "Offset is outside the bounds of the DataView", effect: "parts are shown unplaced" });
      return g;
    };
    loadVehicleTextures = async function(){};
    buildTrackGeometry = function(){ throw new Error("track nodes missing"); };
    await loadVehicleModel("t86");
    out.load = Object.assign(say(), { onScreen: !!(App.geomData && App.geomData.length), key: App.vehicleKey });
    // ---- 5. and a vehicle that cannot be read at all points at the manual route ----
    extractVehicleGeometry = async function(){ throw new Error("unsupported DynModel header 0x7"); };
    await loadVehicleModel("t86b");
    out.fatal = say();
  } catch (e) { out.load = { threw: String(e.message || e) }; }
  finally { extractVehicleGeometry = realX; loadVehicleTextures = realTex; buildTrackGeometry = realTracks; }

  // ---- 6. the sentence itself: parts sharing a reason are one clause; stores are named ----
  out.grouped = ModelLoss.note([{ piece: "flap_l", why: "W" }, { piece: "flap_r", why: "W" }, { piece: "gun", why: "V" }]);
  out.noneNote = ModelLoss.note([]);
  out.stores = LoadoutHang.losses({ failed: ["gbu_12", "gbu_12", "aim_9"], why: new Map([["gbu_12", "unsupported vertex format 7-40"]]),
                                    partial: new Set(["pod_x"]) });
  out.noStores = LoadoutHang.losses({ failed: [] });
  return out;
}`;

const r0 = await evalInPage({ browser, expr: pageExpr(BODY), keep: argv.includes("--keep") });
if (!r0.ok) { console.log("FAIL: " + r0.reason); process.exit(1); }
const r = r0.result;
if (r.__threw) { console.log("FAIL: the test body threw\n" + r.__threw); process.exit(1); }

console.log("\n=== one unknown vertex format ===");
console.log(`   ${JSON.stringify(r.partial)}`);
R.is(r.control.objects === "hull:1 gun:1" && Array.isArray(r.control.dropped) && r.control.dropped.length === 0,
  `the control reads both parts and drops nothing (${r.control.objects}) — or the synthetic buffers prove nothing`);
R.is(!r.partial.threw && r.partial.objects === "hull:1 gun:0" && r.partial.verts === 3,
  `a buffer in an unknown format costs the part drawn from it, not the model (${r.partial.threw || r.partial.objects})`);
const D = (r.partial.dropped || [])[0] || {};
R.is((r.partial.dropped || []).length === 1 && D.piece === "gun" && /unsupported vertex format 99-12/.test(D.why || ""),
  `and the loss is named, with its reason (${JSON.stringify(r.partial.dropped)})`);
R.is(/unsupported vertex format 9[89]-12/.test(r.none.threw || ""),
  `a model with nothing readable is still an error, naming the format (${r.none.threw})`);
R.is(r.f5 && r.f5.read, "a format-5 buffer at stride 24 is read — the synthetic layout is the reader's, or the next three prove nothing");
R.is(r.f5 && r.f5.minority === "false,false,false,true",
  `format 5 still marks its parts where it is the minority — a net, a propeller disc (${r.f5 && r.f5.minority})`);
R.is(r.f5 && r.f5.majority === "false,false,false" && r.f5.all === "false,false",
  `but where it is most of the model it is the model's own vertex format, and marks nothing — or every ship loads as an empty scene (${r.f5 && r.f5.majority} / ${r.f5 && r.f5.all})`);
R.is(/no vertex data of its own/.test(r.noMvd || "") && !/compute/.test(r.noMvd || ""),
  `a resource with no vertex data says so in words, not as a null dereference (${r.noMvd})`);

console.log("\n=== a garbage skeleton and a garbage clip ===");
console.log(`   ${JSON.stringify(r.extract)}`);
R.is(!r.extract.threw && r.extract.faces === "1,0" && r.extract.skeleton === null && r.extract.a2d === null,
  `extractVehicleGeometry still returns the geometry, unplaced and unanimated (${r.extract.threw || r.extract.faces})`);
R.is(/^its model resource could not be read \(Offset is outside/.test(r.unparsed || ""),
  `a resource that does not parse at all says which thing could not be read (${r.unparsed})`);
R.is(r.extract.pieces && r.extract.pieces.join("|") === "the skeleton|gun|the baked animation",
  `and names every loss — the skeleton, the part, the animation (${r.extract.pieces && r.extract.pieces.join(", ")})`);

console.log("\n=== what the user reads ===");
console.log(`   "${r.load.text}"`);
console.log(`   "${r.fatal && r.fatal.text}"`);
R.is(!r.load.threw && r.load.onScreen && r.load.key === "t86", `the vehicle is on screen despite the losses (${r.load.threw || r.load.key})`);
R.is(/left out/.test(r.load.text) && /gun/.test(r.load.text) && /unsupported vertex format 99-12/.test(r.load.text)
  && /skeleton/.test(r.load.text) && /track preview/.test(r.load.text),
  "the closing sentence names each loss — the part and its reason, the skeleton, the track preview that used to go to the console");
R.is(/Add files/.test(r.load.text) && /\.obj/.test(r.load.text), "…and points at the manual route that still works (§0.3)");
R.is(/warn/.test(r.load.cls) && !/\bok\b/.test(r.load.cls), `…as a warning, not a success (class "${r.load.cls}")`);
R.is(/unsupported DynModel header 0x7/.test(r.fatal.text) && /Add files/.test(r.fatal.text) && /err/.test(r.fatal.cls),
  "a vehicle that cannot be read at all says why, and names the manual route too");

console.log("\n=== the sentence ===");
console.log(`   ${r.grouped}`);
console.log(`   ${r.stores}`);
R.is(/left out: 2 parts flap_l, flap_r \(W\); part gun \(V\)/.test(r.grouped) && r.noneNote === "",
  "parts that share a reason are one clause, each reason is said once, and nothing lost says nothing");
R.is(/could not read gbu_12 \(unsupported vertex format 7-40\), aim_9/.test(r.stores) && !/gbu_12.*gbu_12/.test(r.stores)
  && /hung with a piece missing: pod_x/.test(r.stores) && r.noStores === "",
  "a loadout names the store models it could not read, once each and with the reason, and the ones hung with a piece missing — where it used to say only \"2 model(s) unreadable\"");

const errs = (r.__errs || []).concat(r.__rejs || []).filter(e => !/three|jszip|cdnjs|net::|Failed to load/i.test(e));
R.is(errs.length === 0, errs.length ? "uncaught errors during the run:\n        " + errs.join("\n        ") : "no uncaught errors during the run");
R.finish();
