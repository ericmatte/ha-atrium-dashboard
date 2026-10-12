// Body-attached popover so it escapes parent overflow/transform clipping
// (rooms have `overflow: hidden`). Only one popover open at a time across
// the app.
import STYLE from "./popover.css";

const STYLE_ID = "atrium-popover-style";

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

const _registry = new Map();

export function closeAllPopovers() {
  for (const close of [..._registry.values()]) close();
}

export function closePopoverFor(anchor) {
  const close = _registry.get(anchor);
  if (close) close();
}

export function openPopover({ anchor, content, width, maxWidth, onClose }) {
  ensureStyle();

  if (_registry.has(anchor)) {
    _registry.get(anchor)();
    return null;
  }
  closeAllPopovers();

  const pop = document.createElement("div");
  pop.className = "atrium-pop";
  pop.setAttribute("role", "dialog");
  if (width != null) pop.style.width = typeof width === "number" ? `${width}px` : width;
  if (maxWidth != null) pop.style.maxWidth = typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth;
  pop.appendChild(content);

  // Append off-screen first so we can measure the popover before positioning.
  pop.style.left = "-9999px";
  pop.style.top = "0px";
  document.body.appendChild(pop);

  const place = () => {
    const aRect = anchor.getBoundingClientRect();
    const popW = pop.offsetWidth;
    const popH = pop.offsetHeight;
    const margin = 8;
    const gap = 6;

    let left = aRect.left;
    if (left + popW > window.innerWidth - margin) left = aRect.right - popW;
    left = Math.max(margin, Math.min(left, window.innerWidth - margin - popW));

    let top = aRect.bottom + gap;
    let flipTop = false;
    if (top + popH > window.innerHeight - margin) {
      const above = aRect.top - popH - gap;
      if (above >= margin) {
        top = above;
        flipTop = true;
      } else {
        top = Math.max(margin, window.innerHeight - margin - popH);
      }
    }

    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.classList.toggle("flip-top", flipTop);
  };
  place();

  let opened = false;
  requestAnimationFrame(() => {
    pop.classList.add("open");
    opened = true;
  });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
    _registry.delete(anchor);
    anchor.classList?.remove?.("atrium-pop-open");

    const finish = () => {
      pop.removeEventListener("transitionend", onEnd);
      if (pop.parentNode) pop.parentNode.removeChild(pop);
      if (onClose) onClose();
    };
    const onEnd = (e) => {
      if (e.target !== pop || e.propertyName !== "opacity") return;
      finish();
    };

    if (!opened) {
      finish();
      return;
    }
    pop.addEventListener("transitionend", onEnd);
    pop.classList.remove("open");
    // Safety net in case the browser drops the transitionend event.
    setTimeout(finish, 240);
  };

  const onDown = (e) => {
    // The popover lives on document.body but anchors live inside nested shadow
    // roots (hui-card, …). Across a shadow boundary `e.target` is retargeted to
    // the host, so `anchor.contains(e.target)` is false even when the click IS
    // on the anchor — which used to close-then-reopen on a repeat anchor click.
    // composedPath() pierces the shadow boundaries and reports the true path.
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    if (path.includes(pop) || path.includes(anchor)) return;
    if (pop.contains(e.target) || anchor.contains(e.target)) return;
    close();
    // A press outside only closes the popover: neither it nor its release
    // or click reach whatever is under it (a tile, a routine, a room).
    e.stopPropagation();
    e.preventDefault();
    swallowGesture();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const onScroll = (e) => { if (pop.contains(e.target)) return; close(); };
  const onResize = () => place();

  window.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onResize);

  _registry.set(anchor, close);
  anchor.classList?.add?.("atrium-pop-open");

  return { close };
}

// Stops the rest of a press that closed a popover — the compatibility mouse
// and touch events, the release and the click — before any element sees it.
// It lasts until just after the release (the click comes right then), with
// a long fallback in case the release never arrives. The press may still
// scroll the page; only the events are held back.
const GESTURE_EVENTS = ["pointerup", "mousedown", "mouseup", "touchstart", "touchend", "click", "auxclick", "contextmenu"];
function swallowGesture() {
  const stop = (e) => {
    e.stopPropagation();
    // Cancelling a touchstart would also block the scroll.
    if (e.type !== "touchstart") e.preventDefault();
    if (e.type === "pointerup") setTimeout(done, 400);
  };
  const onCancel = () => setTimeout(done, 400);
  const fallback = setTimeout(() => done(), 10000);
  function done() {
    clearTimeout(fallback);
    for (const type of GESTURE_EVENTS) window.removeEventListener(type, stop, true);
    window.removeEventListener("pointercancel", onCancel, true);
  }
  for (const type of GESTURE_EVENTS) window.addEventListener(type, stop, { capture: true, passive: false });
  window.addEventListener("pointercancel", onCancel, true);
}

export function buildPopoverHeader(title, count) {
  const h = document.createElement("div");
  h.className = "atrium-pop-header";
  const t = document.createElement("span");
  t.className = "atrium-pop-title";
  t.textContent = title;
  h.appendChild(t);
  if (count != null) {
    const c = document.createElement("span");
    c.className = "atrium-pop-count";
    c.textContent = count;
    h.appendChild(c);
  }
  return h;
}

export function buildPopoverEmpty(text) {
  const e = document.createElement("div");
  e.className = "atrium-pop-empty";
  e.textContent = text;
  return e;
}

// Header + optional extra content + a list of items (or an empty placeholder).
// Callers inject their own item stylesheet and track the anchor via `onClose`.
export function openListPopover({
  anchor, title, countLabel, items, buildItem,
  emptyText, extraContent, listClass = "atrium-pop-list", listStyle, width, onClose,
}) {
  const root = document.createElement("div");
  root.appendChild(buildPopoverHeader(title, countLabel));
  if (extraContent) root.appendChild(extraContent);

  const list = document.createElement("div");
  list.className = listClass;
  if (listStyle) list.style.cssText = listStyle;
  if (!items.length && emptyText != null) {
    list.appendChild(buildPopoverEmpty(emptyText));
  } else {
    for (const item of items) list.appendChild(buildItem(item));
  }
  root.appendChild(list);

  return openPopover({ anchor, content: root, width, onClose });
}
