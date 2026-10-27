// Folders in the decal library — the tree rules, not the widgets.
//
// DecalTree is pure on purpose: renaming a folder has to carry its whole subtree, deleting one has
// to decide what happens to the contents, and an index entry written before folders existed has to
// land somewhere sensible. Those are the parts that break, and none of them need a browser.
//
// The property that keeps an old library working is that folders are IMPLIED as well as explicit:
// a decal whose folder is "a/b" makes "a" and "a/b" exist whether or not anything created them. So
// a lost folder list reconstructs itself, and an entry with no `folder` field reads as the root.
//
// Usage: node tools/t34_decalfolders.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "wt_skin_studio.html"), "utf8");
const a = src.search(/[\n>]\/\*==DECALTREE==\*\//), b = src.indexOf("\n/*==ENDDECALTREE==*/");
if (a < 0 || b < 0) throw new Error("no DECALTREE section in the page");
const { DecalTree: T } = new Function(src.slice(a + 1, b) + "\nreturn { DecalTree };")();

let checks = 0, fails = 0;
const ok = m => { checks++; console.log("  ok   " + m); };
const bad = m => { checks++; fails++; console.log("  FAIL " + m); };
const eq = (got, want, m) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  g === w ? ok(`${m}  →  ${g}`) : bad(`${m}\n         got  ${g}\n         want ${w}`);
};

// A library shaped like a real one: nested folders, a decal at the root, and one LEGACY entry with
// no `folder` field at all — the shape everything written before this feature has.
const decals = () => [
  { id: "d1", name: "raf roundel", folder: "Roundels/RAF" },
  { id: "d2", name: "raf fin flash", folder: "Roundels/RAF" },
  { id: "d3", name: "usaf star", folder: "Roundels/USAF" },
  { id: "d4", name: "kill mark", folder: "Markings" },
  { id: "d5", name: "loose sticker" },                       // legacy: no folder field
  { id: "d6", name: "nose art", folder: "" },                // explicit root
];
const folders = () => ["Roundels", "Roundels/RAF", "Roundels/USAF", "Markings", "Empty/Deep"];

console.log("=== paths ===");
eq(T.segs("a/b/c"), ["a", "b", "c"], "segs splits");
eq(T.segs("  /a//  b /"), ["a", "b"], "segs trims blanks and stray separators");
eq(T.norm("/a//b/"), "a/b", "norm canonicalises");
eq(T.norm(undefined), "", "norm of undefined is the root");
eq(T.parent("a/b/c"), "a/b", "parent");
eq(T.parent("a"), "", "parent of a top-level folder is the root");
eq(T.parent(""), "", "parent of the root is the root");
eq(T.name("a/b/c"), "c", "name");
eq(T.join("a/b", "c"), "a/b/c", "join");
eq(T.join("", "top"), "top", "join onto the root");
eq(T.join("a", "  "), "a", "join with a blank name is a no-op");
eq(T.cleanName("a/b\\c"), "a b c", "cleanName strips both separators — a name cannot contain one");
eq(T.cleanName("  spaced   out  "), "spaced out", "cleanName collapses whitespace");
eq(T.cleanName("x".repeat(90)).length, 60, "cleanName caps length");

console.log("\n=== isUnder ===");
eq(T.isUnder("a/b", "a"), true, "a/b is under a");
eq(T.isUnder("a", "a"), true, "a is under itself");
eq(T.isUnder("ab", "a"), false, "ab is NOT under a (prefix must end at a separator)");
eq(T.isUnder("a", "a/b"), false, "a parent is not under its child");
eq(T.isUnder("", ""), true, "the root is under the root — this is what makes root counts right");
eq(T.isUnder("a/b", ""), true, "everything is under the root");

console.log("\n=== implied folders ===");
// the whole forward/backward-compatibility story lives here
eq(T.all([], [{ id: "x", folder: "a/b/c" }]), ["a", "a/b", "a/b/c"],
  "a decal's path implies every folder above it, with no folder list at all");
eq(T.all(["Solo"], []), ["Solo"], "an explicit empty folder survives with no decals in it");
{
  const withList = T.all(folders(), decals());
  const noList = T.all([], decals());
  eq(noList.includes("Roundels/RAF") && noList.includes("Roundels"), true,
    "losing the folder list still reconstructs every folder that holds a decal");
  eq(withList.includes("Empty/Deep") && !noList.includes("Empty/Deep"), true,
    "only an EMPTY folder actually needs the stored list");
}

console.log("\n=== listing ===");
eq(T.children(folders(), decals(), ""), ["Empty", "Markings", "Roundels"], "root's immediate subfolders");
eq(T.children(folders(), decals(), "Roundels"), ["Roundels/RAF", "Roundels/USAF"], "nested subfolders");
eq(T.children(folders(), decals(), "Roundels/RAF"), [], "a leaf folder has no children");
eq(T.decalsIn(decals(), "Roundels/RAF").map(d => d.id), ["d1", "d2"], "decals in a folder");
eq(T.decalsIn(decals(), "").map(d => d.id), ["d5", "d6"],
  "the root holds the legacy entry with NO folder field and the one set to \"\"");
eq(T.count(decals(), "Roundels"), 3, "count is recursive");
eq(T.count(decals(), ""), 6, "root counts everything");
eq(T.count(decals(), "Markings"), 1, "count of a leaf");

console.log("\n=== rename ===");
{
  const r = T.rename(folders(), decals(), "Roundels", "Insignia");
  eq(r.path, "Insignia", "renamed folder's new path");
  eq(r.folders.includes("Insignia/RAF") && r.folders.includes("Insignia/USAF"), true, "the subtree came with it");
  eq(r.folders.some(f => f === "Roundels" || f.startsWith("Roundels/")), false, "no trace of the old path is left");
  eq(r.decals.filter(d => d.folder === "Insignia/RAF").map(d => d.id), ["d1", "d2"], "decals were re-pathed");
  eq(r.decals.find(d => d.id === "d4").folder, "Markings", "an unrelated folder is untouched");
  eq(r.decals.find(d => d.id === "d5").folder, undefined, "a legacy root entry is left exactly as it was");
}
{
  const r = T.rename(folders(), decals(), "Roundels/RAF", "Fleet Air Arm");
  eq(r.path, "Roundels/Fleet Air Arm", "renaming a nested folder keeps its parent");
  eq(r.decals.filter(d => d.folder === "Roundels/Fleet Air Arm").length, 2, "its decals moved with it");
}
eq(T.rename(folders(), decals(), "Roundels/RAF", "USAF"), null, "refuses a name already taken by a sibling");
eq(T.rename(folders(), decals(), "Roundels/RAF", "usaf"), null, "refuses it case-insensitively too");
eq(T.rename(folders(), decals(), "Roundels/RAF", "   "), null, "refuses an empty name");
eq(T.rename(folders(), decals(), "Markings", "Markings").path, "Markings", "renaming to the same name is a no-op, not an error");
{
  // a name containing the separator must not smuggle in a new level
  const r = T.rename(folders(), decals(), "Markings", "a/b");
  eq(r.path, "a b", "a separator in a new name is neutralised rather than creating a subfolder");
}

console.log("\n=== delete, keeping the contents (mode \"up\") ===");
{
  const r = T.remove(folders(), decals(), "Roundels", "up");
  eq(r.removed, [], "nothing is deleted");
  eq(r.decals.filter(d => d.id === "d1")[0].folder, "RAF", "a nested folder re-parents one level up");
  eq(r.decals.filter(d => d.id === "d3")[0].folder, "USAF", "and so does its sibling");
  eq(r.folders.includes("RAF") && r.folders.includes("USAF"), true, "the subfolders survive at the new level");
  eq(r.folders.includes("Roundels"), false, "the deleted folder is gone");
  eq(r.folders.includes("Empty/Deep"), true, "an unrelated folder is untouched");
}
{
  const r = T.remove(folders(), decals(), "Roundels/RAF", "up");
  eq(r.decals.filter(d => d.id === "d1")[0].folder, "Roundels", "decals move to the deleted folder's parent");
  eq(r.decals.filter(d => d.id === "d3")[0].folder, "Roundels/USAF", "a sibling folder is untouched");
}

console.log("\n=== delete, contents and all (mode \"all\") ===");
{
  const r = T.remove(folders(), decals(), "Roundels", "all");
  eq(r.removed.sort(), ["d1", "d2", "d3"], "every decal in the subtree is reported for deletion");
  eq(r.decals.map(d => d.id), ["d4", "d5", "d6"], "and removed from the index");
  eq(r.folders.some(f => f.startsWith("Roundels")), false, "the whole subtree is gone");
  eq(r.folders.includes("Markings"), true, "unrelated folders remain");
}
{
  // "delete the root" would wipe the library, so it has to be a no-op rather than a fast path
  const r = T.remove(folders(), decals(), "", "all");
  eq([r.removed.length, r.decals.length, r.folders.length], [0, decals().length, folders().length],
    "deleting the root is refused outright — nothing removed, index and folder list intact");
}

console.log("\n=== move ===");
{
  const r = T.move(decals(), ["d5", "d4"], "Roundels/RAF");
  eq(r.filter(d => d.folder === "Roundels/RAF").map(d => d.id).sort(), ["d1", "d2", "d4", "d5"],
    "moved decals join the target folder, alongside the ones already there");
  eq(r.find(d => d.id === "d5").folder, "Roundels/RAF", "a legacy entry gains a folder when moved");
  eq(r.find(d => d.id === "d3").folder, "Roundels/USAF", "unmoved decals are untouched");
  eq(r.length, decals().length, "nothing is lost or duplicated");
}
eq(T.move(decals(), ["d1"], "").find(d => d.id === "d1").folder, "", "moving to the root is allowed");

console.log("\n=== search spans every folder ===");
eq(T.search(decals(), "raf").map(d => d.id), ["d1", "d2"], "matches on name");
eq(T.search(decals(), "usaf").map(d => d.id), ["d3"], "matches on folder path too");
eq(T.search(decals(), "MARK").map(d => d.id), ["d4"], "case-insensitive");
eq(T.search(decals(), "   "), null, "a blank query means 'not searching', not 'no results'");
eq(T.search(decals(), "zzz"), [], "a query with no hits is an empty list");

console.log("\n=== variants ===");
// The index order a real library has after saving a base, two variants of it, then something else.
const fam = () => [
  { id: "d9", name: "later thing" },
  { id: "d1", name: "raf roundel", folder: "Roundels/RAF" },
  { id: "v1", name: "raf roundel v2", folder: "Roundels/RAF", base: "d1" },
  { id: "v2", name: "raf roundel v3", folder: "Roundels/RAF", base: "d1" },
  { id: "d4", name: "kill mark", folder: "Markings" },
];
eq(T.rootId({ id: "d1" }), "d1", "a decal with no base is its own root");
eq(T.rootId({ id: "v1", base: "d1" }), "d1", "a variant's root is what it branched from");
eq(T.variantsOf(fam(), "d1").map(d => d.id), ["v1", "v2"], "variantsOf lists the branches");
eq(T.variantsOf(fam(), "d1").some(d => d.id === "d1"), false, "and never counts the base as its own variant");
eq(T.variantsOf(fam(), "d4"), [], "a decal with no variants has none");
// This is what keeps a family together in the grid instead of scattering it by save time.
eq(T.familyEnd(fam(), "d1"), 4, "a new variant is inserted straight after the last member of its family");
eq(T.familyEnd(fam(), "d4"), 5, "a family of one ends right after it");
eq(T.familyEnd(fam(), "gone"), -1, "an unknown base means 'no position' — the caller puts it at the front");
{
  // A variant of a variant must stay in ONE flat family, never grow a chain: rootId of the thing
  // being branched from is what DecalLib stores, so re-varianting v1 still points at d1.
  const list = fam();
  eq(T.rootId(list.find(d => d.id === "v1")), "d1", "branching off a variant still roots at the original");
}
eq(T.variantName(fam(), "d1", "raf roundel"), "raf roundel v4", "an untouched name takes the next free number in the family");
eq(T.variantName(fam(), "d1", "raf roundel v2"), "raf roundel v4", "and does not stack suffixes on a name that already has one");
eq(T.variantName([], "d1", "kill mark"), "kill mark v2", "the first variant of a decal is v2");
eq(T.variantName(fam(), "d4", ""), "decal v2", "an empty name still produces something usable");

console.log("\n=== nothing mutates its input ===");
{
  const f = folders(), d = decals();
  const fBefore = JSON.stringify(f), dBefore = JSON.stringify(d);
  T.rename(f, d, "Roundels", "X"); T.remove(f, d, "Roundels", "up");
  T.remove(f, d, "Roundels", "all"); T.move(d, ["d1"], "Q"); T.add(f, "New/Deep");
  eq(JSON.stringify(f), fBefore, "the folder list is never mutated in place");
  eq(JSON.stringify(d), dBefore, "the decal index is never mutated in place");
}

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
