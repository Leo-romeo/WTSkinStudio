/*==LAYERTREE==*/
"use strict";
// ---------- The layer tree ----------
// `slot.layers` is an ordered list of NODES, bottom of the stack first. A node is either a layer —
// paint, fill, decal, adjust, exactly what it always was — or a **group**: a node carrying what a
// layer carries (name, visible, opacity, blend, its own mask, its own part scope) and applying all
// of it to the composite of its children. ROADMAP 4.9.
//
// **A group is deliberately not channel-tagged.** The case that was asked for is one marking whose
// colour, normal and smoothness move as a single thing, so the *children* carry the channels and
// each still composites into its own sheet; the group's opacity, mask and scope are folded in on
// the way. A group tagged with a channel could not hold that decal at all.
//
// Three ad-hoc grouping mechanisms already exist and each faked it differently — `proj.id` for the
// halves of one projected decal across slots, `link` for one fill created per slot a part selection
// touches, and `L.mask`, which is the "mask layer" already except that it belongs to exactly one
// layer. A real group subsumes all three. They are still here; this is the container they will move
// onto.
//
// Everything below is a pure function of the tree. No DOM, no App state, no canvases — so it is
// liftable into a worker and testable under Node, and so that "which layers are in this slot" has
// exactly one answer.
function isGroup(n){ return !!n && n.type === "group" && Array.isArray(n.children); }

// Every LEAF under `nodes`, in stack order. This is what `slot.layers` meant to almost every caller
// while the array was flat — "every layer in this slot" — and it is the replacement for iterating
// the array directly anywhere the question is about layers rather than about structure.
function layerLeaves(nodes){
  const out = [];
  const walk = list => { for (const n of list) isGroup(n) ? walk(n.children) : out.push(n); };
  walk(nodes || []);
  return out;
}
// Leaves whose whole ancestor chain is visible, and which are visible themselves. A layer inside a
// hidden group is not on screen, so anything asking "is anything of this channel showing?" has to
// prune at the group rather than test the leaf — the flat array had no way to be wrong about this
// and the tree does.
function visibleLeaves(nodes){
  const out = [];
  const walk = list => {
    for (const n of list) {
      if (!n.visible) continue;
      isGroup(n) ? walk(n.children) : out.push(n);
    }
  };
  walk(nodes || []);
  return out;
}
// Every node, groups included, in stack order with a group listed before its children. For the
// things that really are about structure: the layer list, saving, and counting.
function layerNodes(nodes){
  const out = [];
  const walk = list => { for (const n of list) { out.push(n); if (isGroup(n)) walk(n.children); } };
  walk(nodes || []);
  return out;
}
// The array a node lives in, and where in it — the tree's answer to `indexOf`. Returned rather than
// a path because every structural edit (move, delete, duplicate, drop into a group) wants the array
// and the index, and reconstructing them from a path is the step that gets written five times.
function nodeOwner(nodes, node){
  const walk = list => {
    const i = list.indexOf(node);
    if (i >= 0) return { list, i };
    for (const n of list) if (isGroup(n)) { const r = walk(n.children); if (r) return r; }
    return null;
  };
  return walk(nodes || []);
}
// Is `node` inside `maybeGroup` (at any depth)? The guard a drag-into-group needs: dropping a group
// into its own child detaches the whole subtree from the slot and loses it.
function nodeContains(maybeGroup, node){
  if (!isGroup(maybeGroup)) return false;
  for (const n of maybeGroup.children) if (n === node || nodeContains(n, node)) return true;
  return false;
}
// How deep a node sits, for the layer list's indentation. -1 if it is not in this tree.
function nodeDepth(nodes, node){
  const walk = (list, d) => {
    for (const n of list) {
      if (n === node) return d;
      if (isGroup(n)) { const r = walk(n.children, d + 1); if (r >= 0) return r; }
    }
    return -1;
  };
  return walk(nodes || [], 0);
}
/*==ENDLAYERTREE==*/
