/*==SCROLLBOX==*/
"use strict";
// ---------- A scroll box says there is more below it ----------
// ROADMAP 3.27(c). A scroll bar already says a list scrolls, but only once the pointer is inside it
// and only if the browser is drawing one — on an overlay-scrollbar platform a list that continues
// past the fold looks exactly like a list that ends there. So the box fades its own bottom edge
// while content remains, and stops the moment you reach the end.
//
// The fade itself is CSS (`.scrollbox.more`, an inset background gradient rather than an overlay
// element — it costs no DOM and a row stays clickable through it). All this does is decide when the
// class is on, and it is deliberately the cheapest possible answer: no `scroll-timeline`, no
// IntersectionObserver per row, one comparison per scroll event.
//
// One binding, on the pattern CLAUDE.md §4 asks for — the alternative was two more globals for the
// handler and the observer.
const Scrollbox = {
  // 2 px, not 0: `scrollTop` is fractional on a zoomed page and on a trackpad's inertial tail, so an
  // exact comparison leaves the fade on over a list that has visibly ended.
  SLACK: 2,
  sync(el){
    if (!el) return;
    const more = el.scrollHeight - el.clientHeight - el.scrollTop > Scrollbox.SLACK;
    el.classList.toggle("more", more);
  },
  // Idempotent: panels re-render into these boxes constantly and `watch` is called from load, so a
  // second call must not stack a second listener. The flag is a property of the element rather than
  // a set kept here, which means a box that is thrown away takes its own bookkeeping with it.
  watch(el){
    if (!el || el._sbWatched) return;
    el._sbWatched = true;
    el.addEventListener("scroll", () => Scrollbox.sync(el), { passive: true });
    // The content changes far more often than the box is scrolled — every search keystroke, every
    // slot list refresh — and a resize of the box itself (it is `resize:vertical`) changes the
    // answer too. One observer covers both.
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => Scrollbox.sync(el)).observe(el);
    if (typeof MutationObserver !== "undefined")
      new MutationObserver(() => Scrollbox.sync(el)).observe(el, { childList: true, subtree: true });
    Scrollbox.sync(el);
  },
  // Every box on the page, so a new one is styled and watched by adding one class in the markup
  // rather than by remembering to wire it up here.
  watchAll(){ document.querySelectorAll(".scrollbox").forEach(Scrollbox.watch); },
};
/*==ENDSCROLLBOX==*/
