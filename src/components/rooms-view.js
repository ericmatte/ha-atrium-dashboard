// `set hass()` fires on every state change. The DOM is never torn down on a
// state change: orbs and the open panel's tiles are updated in place, since
// the design leans on CSS transitions (panel slide, orb resize, track fills)
// that a rebuilt element would skip. Only a change in *which* areas/entities
// are shown rebuilds the floors or the panel content.

import { closePopoverFor, openListPopover } from "../lib/popover.js";
import { t, setLanguage } from "../lib/i18n.js";
import { Optimistic } from "../lib/optimistic.js";
import { sameRegistries, unchangedStates, areaIdForEntity, entityDisplayName } from "../lib/hass-utils.js";
import { fireMoreInfo, haIcon } from "../lib/dom-utils.js";
import { callService, toggleLights } from "../lib/ha-actions.js";
import { STYLE, ICONS, iconForArea, fmtCoverPct, canDimLight, nameWithoutAreaPrefix, ensurePopoverItemStyle, lightsAuraColors, auraGradient } from "./area-card-shared.js";
import {
  entitiesForArea,
  isShownEntity,
  classifyAreaEntities,
  areaIsEmpty,
  areaAlert,
  areaPresence,
  areaActivity,
  areaStatusDot,
  areaMetaParts,
  lightsSummary,
  levelTone,
  areaPanelSignature,
} from "../lib/area-data.js";
import * as buildersMod from "./area-card-builders.js";
import * as updatersMod from "./area-card-updaters.js";
import { subscribeLabelsLoaded } from "../lib/label-registry.js";
import { orbGrid, orbBadgeFont } from "../lib/orb-grid.js";
import { tempColor, humidityColor, toCelsius } from "../lib/comfort-colors.js";

// Matches the panel's exit (desktop slide / phone sheet-out, .26s in
// area-card.css) so the selection is only dropped once it has played.
const CLOSE_MS = 260;
// The nearest scrolling ancestor, across shadow roots (HA nests the view in
// several), else the page.
function scrollParent(el) {
  for (let n = el.parentNode ?? el.host; n; n = n.parentNode ?? n.host) {
    if (n.nodeType !== 1) continue;
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement;
}

const REVEAL_MARGIN = 12;

// Keys pressed in a field, on a slider or inside a dialog are theirs, not ours.
const OWN_ARROWS = new Set(["INPUT", "TEXTAREA", "SELECT", "HA-DIALOG", "HA-MORE-INFO-DIALOG", "DIALOG", "HA-TEXTFIELD", "HA-SLIDER", "HA-SELECT"]);
function keyBelongsElsewhere(e) {
  return e.composedPath().some((el) => el.nodeType === 1 && (OWN_ARROWS.has(el.tagName) || el.isContentEditable || el.getAttribute?.("role") === "slider"));
}

// Phone: a horizontal swipe on the open room's panel steps to the next or
// previous room. It's decided on the first few px of travel: clearly
// sideways is ours (the panel follows the finger), anything else is left to
// the scroll. The open room then follows the finger, with the room it leads
// to sliding in beside it; let go past a third of the way, or with a flick,
// and that room becomes the open one. Swipes that start on a slider (lights,
// covers, volume) are theirs.
const SWIPE_DECIDE = 12;
const SWIPE_STEP_AT = 0.3; // of the panel's width
const SWIPE_STEP_SPEED = 0.45; // px/ms
// Space between the open room and the next one peeking in beside it.
const PEEK_GAP = 24;
// Along the way, the open room shrinks and fades as it slides out, and the
// next one grows back to full size as it fades in: at the start it's at
// this scale and opacity.
const PEEK_SCALE = 0.92;
const PEEK_OPACITY = 0.3;

// How the open room (`out`) and the one it leads to (`in`) look with the
// open room slid `x` px, the next one `span` px further in direction `dir`.
function swipeLook(x, span, dir) {
  const p = Math.min(1, Math.abs(x) / span);
  const look = (shift, k) => ({
    transform: `translateX(${shift}px) scale(${PEEK_SCALE + (1 - PEEK_SCALE) * k})`,
    opacity: String(PEEK_OPACITY + (1 - PEEK_OPACITY) * k),
  });
  return { out: look(x, 1 - p), in: look(x + dir * span, p) };
}
const SWIPE_IGNORE = ".atrium-diva-track, input, .atrium-media-volume, .atrium-pop";

// Animated custom properties (the routines' hold-to-trigger ring filling up,
// the ring circling a running routine). An @property rule is ignored inside a
// shadow root — where Home Assistant renders cards — and an unregistered
// property can't animate (it would jump), so they're registered on the page.
for (const [name, syntax, initialValue] of [["--atrium-hold", "<percentage>", "0%"], ["--atrium-ring", "<angle>", "0deg"]]) {
  try { globalThis.CSS?.registerProperty?.({ name, syntax, inherits: false, initialValue }); } catch (_) { /* already registered */ }
}
const isNight = (hass) => hass.states?.["sun.sun"]?.state === "below_horizon";
// The aura blends its colors in OKLCH where the browser can.
const AURA_SPACE = globalThis.CSS?.supports?.("background", "conic-gradient(in oklch, red, blue)") ? "oklch" : undefined;
const PANEL_HISTORY_KEY = "atriumPanel";
// Must match the phone breakpoint in area-card.css.
const SHEET_MEDIA = "(max-width: 860px)";
const SWIPE_SLOP = 6;
const SWIPE_CLOSE_AT = 0.25;
const SWIPE_FLICK_SPEED = 0.6; // px/ms

// Scrolled all the way down (within a couple of px) — a panel that doesn't
// scroll at all is neither.
const canScroll = (el) => el.scrollHeight - el.clientHeight > 2;
const atBottom = (el) => canScroll(el) && el.scrollHeight - el.clientHeight - el.scrollTop < 2;

const heroBadgesKey = (els) => els.map((b) => `${b.className}|${b.textContent}|${b.style.color}|${b.querySelector("ha-icon")?.getAttribute("icon")}`).join(";");

// Screen-reader label of the bottom-right "what's running" badge, by kind.
const ACTIVITY_LABEL = {
  media: (name) => t("playPause", name),
  vacuum: (name) => t("pauseName", name),
  heating: (name) => t("heatingName", name),
  cooling: (name) => t("coolingName", name),
};

class AtriumRooms extends HTMLElement {
  constructor() {
    super();
    this._dragState = new Map();
    this._openAnchors = new Set();
    this._selectedAreaId = null;
    this._closing = false;
    this._orbRefs = new Map();
    this._lastClimateMode = new Map();
    // The Routines' "inactive" drawer: opened or closed in one room, it's the
    // same in every room.
    this._showInactive = false;
    // Whether the last room that could scroll was left scrolled to its very
    // bottom (see _buildShell).
    this._stickBottom = false;
    // What the view just asked HA for, shown until HA's state catches up (see
    // optimistic.js); when a value times out, the panel redraws from HA.
    this._optimistic = new Optimistic({ onExpire: () => this._refreshShown() });
    // Escape closes the details panel — unless a menu/popover is open, in
    // which case that Escape is the popover's (it closes itself first).
    // Back button: the panel's history entry was popped. (A dialog opened
    // over the panel — e.g. more-info — pops its own entry first and lands
    // back on ours, which keeps the panel open.)
    this._onPopState = () => {
      if (this._ignoreNextPop) {
        this._ignoreNextPop = false;
        return;
      }
      if (this._selectedAreaId && !history.state?.[PANEL_HISTORY_KEY]) this._closePanel({ fromHistory: true });
    };
    // ←/→ step to the previous/next room while one is open, ↑/↓ (desktop) to
    // the room above/below in the grid — unless the key belongs to something
    // else: a field or slider with focus, a menu, a dialog over the panel.
    this._onKeydown = (e) => {
      if (e.defaultPrevented || !this._selectedAreaId) return;
      if (document.querySelector(".atrium-pop")) return;
      if (e.key === "Escape") return this._select(null);
      const vertical = e.key === "ArrowUp" || e.key === "ArrowDown";
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && !vertical) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || keyBelongsElsewhere(e)) return;
      // On a phone the rooms are one strip: ↑/↓ keep scrolling the panel.
      if (vertical && matchMedia(SHEET_MEDIA).matches) return;
      e.preventDefault();
      if (vertical) this._stepAreaVertical(e.key === "ArrowDown" ? 1 : -1);
      else this._stepArea(e.key === "ArrowRight" ? 1 : -1);
    };
  }

  setConfig(config) {
    // Floors in display order, as strategy.js computed them (real HA floors
    // sorted, plus the virtual "Other" floor for orphan areas).
    if (!Array.isArray(config.floors)) throw new Error("floors is required");
    setLanguage(config.language);
    this._floors = config.floors;
  }

  connectedCallback() {
    this.style.display = "block";
    document.addEventListener("keydown", this._onKeydown);
    window.addEventListener("popstate", this._onPopState);
    if (this._content && !this._resizeObserver) {
      this._resizeObserver = new ResizeObserver(() => this._sizeOrbs());
      this._resizeObserver.observe(this._content);
    }
    this._unsubLabels = subscribeLabelsLoaded(() => {
      this._floorsSig = null;
      this._panelSig = null;
      this._render();
    });
  }

  disconnectedCallback() {
    document.removeEventListener("keydown", this._onKeydown);
    window.removeEventListener("popstate", this._onPopState);
    this._closeOpenPopovers();
    document.documentElement.style.removeProperty("--atrium-panel-open");
    this._unsubLabels?.();
    this._unsubLabels = null;
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
  }

  set hass(hass) {
    this._hass = hass;
    const registriesChanged = !sameRegistries(this, "_reg", hass);
    const statesChanged = !unchangedStates(this, "_stateSnap", hass, this._relevantIds());
    // Sunset/sunrise dims or brightens the tiles of areas without lights.
    const night = isNight(hass);
    const nightChanged = night !== this._night;
    this._night = night;
    if (registriesChanged) this._panelSig = null;
    if (!this._root || registriesChanged || statesChanged || nightChanged) this._render();
  }

  // Every entity anchored to any area on any of our floors — cheap enough
  // to recompute each tick, and simpler than threading a persistent id list
  // through registry changes.
  _relevantIds() {
    const hass = this._hass;
    const ids = [];
    for (const ent of Object.values(hass.entities)) {
      if (!isShownEntity(ent)) continue;
      const areaId = areaIdForEntity(hass, ent);
      if (areaId != null && hass.areas?.[areaId]) ids.push(ent.entity_id);
    }
    return ids;
  }

  _areasOnFloor(floorId) {
    return Object.values(this._hass.areas).filter((a) => (a.floor_id ?? null) === floorId);
  }

  _dataForArea(area) {
    const hass = this._hass;
    const entities = entitiesForArea(hass, area);
    return classifyAreaEntities(hass, area, entities);
  }

  _call(domain, service, data) {
    return callService(this._hass, domain, service, data);
  }

  _moreInfo(entityId) {
    fireMoreInfo(this, entityId);
  }

  _entityName(entity) {
    return entityDisplayName(this._hass, entity);
  }

  // On/off and level as the view shows them: what was just asked for, else HA's.
  _shownOn(entityId) {
    const asked = this._optimistic.get(entityId);
    return asked ? asked.on : this._hass.states?.[entityId]?.state === "on";
  }

  _shownLevel(entityId) {
    const asked = this._optimistic.get(entityId);
    return asked ? asked.level : fmtCoverPct(this._hass.states?.[entityId] || { attributes: {} });
  }

  // Redraws the open panel (in place) so values just asked for show at once.
  _refreshShown() {
    if (this._selectedAreaId && this._hass && this._root) this._renderPanel();
  }

  // "All off" while any light is on; otherwise "All on", at full brightness.
  _toggleAllLights(lights) {
    const ids = lights.map((l) => l.entity_id).filter((id) => this._hass.states?.[id]?.state !== "unavailable");
    if (!ids.length) return;
    if (ids.some((id) => this._shownOn(id))) {
      for (const id of ids) this._optimistic.set(id, { on: false, level: 0 });
      this._call("light", "turn_off", { entity_id: ids });
      this._refreshShown();
    } else this._allLightsOn(ids);
  }

  _allLightsOn(ids) {
    const dimmable = ids.filter((id) => canDimLight(this._hass.states?.[id]));
    const plain = ids.filter((id) => !dimmable.includes(id));
    for (const id of ids) this._optimistic.set(id, { on: true, level: 100 });
    if (dimmable.length) this._call("light", "turn_on", { entity_id: dimmable, brightness_pct: 100 });
    if (plain.length) this._call("light", "turn_on", { entity_id: plain });
    this._refreshShown();
  }

  _toggleAllCovers(covers) {
    if (!covers.length) return;
    const ids = covers.map((c) => c.entity_id);
    const anyOpen = ids.some((id) => this._shownLevel(id) > 5);
    for (const id of ids) this._optimistic.set(id, { on: !anyOpen, level: anyOpen ? 0 : 100 });
    this._call("cover", anyOpen ? "close_cover" : "open_cover", { entity_id: ids });
    this._refreshShown();
  }

  // direction is -1 or +1: the size of the move belongs to the device, not
  // to us. A 1°C heat pump silently ignores 0.5° setpoints a thermostat takes.
  _adjustClimate(entityId, direction) {
    const st = this._hass.states?.[entityId];
    if (!st) return;
    // Quick presses add up: each starts from the setpoint just asked for.
    const cur = this._optimistic.get(`${entityId}:temperature`, (tt) => Number(st.attributes?.temperature) === tt) ?? st.attributes?.temperature;
    if (cur == null) return;
    const step = Number(st.attributes?.target_temp_step) || 0.5;
    const min = Number(st.attributes?.min_temp ?? -Infinity);
    const max = Number(st.attributes?.max_temp ?? Infinity);
    const snapped = Math.round((cur + direction * step) / step) * step;
    const next = Math.min(max, Math.max(min, Number(snapped.toFixed(2))));
    if (next === cur) return;
    this._optimistic.set(`${entityId}:temperature`, next);
    this._call("climate", "set_temperature", { entity_id: entityId, temperature: next });
    this._refreshShown();
  }

  // Tapping the open room again, the close button, or another room while
  // closing all route through here; `null` closes.
  _select(areaId) {
    if (areaId == null || areaId === this._selectedAreaId) this._closePanel();
    else this._openPanel(areaId);
  }

  // The next (1) or previous (-1) room in tile order, wrapping around; its
  // content slides in from the side it came from.
  _stepArea(dir) {
    const ids = [...this._orbRefs.keys()];
    const i = ids.indexOf(this._selectedAreaId);
    if (i < 0 || ids.length < 2) return;
    this._openPanel(ids[(i + dir + ids.length) % ids.length], { slide: dir });
  }

  // The room right below (1) or above (-1) in the grid as laid out on screen:
  // the nearest tile of the next row, by horizontal distance — across floors
  // too. Nothing past the first or last row.
  _stepAreaVertical(dir) {
    const current = this._orbRefs.get(this._selectedAreaId)?.tile;
    if (!current) return;
    const box = (el) => el.getBoundingClientRect();
    const here = box(current);
    const cx = (r) => r.left + r.width / 2;
    const tiles = [...this._orbRefs].map(([areaId, ref]) => ({ areaId, r: box(ref.tile) }));
    const ahead = tiles.filter(({ r }) => (dir > 0 ? r.top > here.top + 4 : r.top < here.top - 4));
    if (!ahead.length) return;
    const rowTop = dir > 0 ? Math.min(...ahead.map((t) => t.r.top)) : Math.max(...ahead.map((t) => t.r.top));
    const row = ahead.filter(({ r }) => Math.abs(r.top - rowTop) < 4);
    const target = row.reduce((best, t) => (Math.abs(cx(t.r) - cx(here)) < Math.abs(cx(best.r) - cx(here)) ? t : best));
    this._openPanel(target.areaId);
  }

  _openPanel(areaId, { slide = 0 } = {}) {
    clearTimeout(this._closeTimer);
    const reopening = !this._selectedAreaId || this._closing;
    // A panel opened from closed starts at the top.
    if (reopening) this._stickBottom = false;
    this._closing = false;
    this._selectedAreaId = areaId;
    if (reopening) this._pushPanelHistory();
    this._renderPanel({ freshPanel: reopening });
    if (this._stickBottom && this._pin) this._pin.scrollTop = this._pin.scrollHeight;
    if (slide && this._pin) {
      this._pin.style.transform = "";
      this._pin.animate([{ transform: `translateX(${slide * 48}px) scale(${PEEK_SCALE})`, opacity: PEEK_OPACITY }, { transform: "none", opacity: 1 }], { duration: 300, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
    this._syncLayout();
    this._revealSelected(areaId, { smooth: !reopening });
  }

  // Keep the open room in view, top left.
  // Phone: the rooms collapse into a strip above the sheet; bring the open
  // room to its left edge (at once when the strip first appears, gliding
  // when switching rooms within it).
  // Desktop: the side panel narrows the grid, which re-flows into fewer
  // columns; scroll the page so the open room's row (with its floor label,
  // when it's the floor's first row) sits just under HA's toolbar.
  _revealSelected(areaId, { smooth }) {
    if (!matchMedia(SHEET_MEDIA).matches) {
      // Two frames: the narrower grid re-sizes its tiles in a ResizeObserver
      // callback after the first layout.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const tile = this._orbRefs.get(areaId)?.tile;
        if (!tile || this._selectedAreaId !== areaId) return;
        // In its floor's first row, the floor label comes along.
        const group = tile.closest(".atrium-floor-group");
        const firstRow = group && tile.getBoundingClientRect().top - (group.querySelector(".atrium-orb")?.getBoundingClientRect().top ?? 0) < 4;
        const anchor = firstRow ? group : tile;
        const scroller = scrollParent(this);
        const page = scroller === document.scrollingElement;
        // Below HA's toolbar, and below Atrium's own header when it's pinned
        // there (desktop Home tab, see header.js).
        const pinned = this.getRootNode()?.querySelector?.("atrium-header.is-sticky");
        const toolbar = (parseFloat(getComputedStyle(this).getPropertyValue("--header-height")) || 0) + (pinned?.offsetHeight ?? 0);
        const top = page ? toolbar : Math.max(scroller.getBoundingClientRect().top, toolbar);
        const target = Math.max(0, scroller.scrollTop + anchor.getBoundingClientRect().top - top - REVEAL_MARGIN);
        if (Math.abs(scroller.scrollTop - target) > 2) scroller.scrollTo({ top: target, behavior: "smooth" });
      }));
      return;
    }
    requestAnimationFrame(() => {
      const strip = this._content;
      const tile = this._orbRefs.get(areaId)?.tile;
      if (!strip || !tile || this._selectedAreaId !== areaId) return;
      // Layout offsets, not client rects: the tiles may still be mid pop-in
      // (scaled down), which would skew a rect. The strip is positioned, so
      // the offsetParent chain from the tile ends at it.
      let left = 0;
      for (let el = tile; el && el !== strip; el = el.offsetParent) left += el.offsetLeft;
      left -= parseFloat(getComputedStyle(strip).paddingLeft) || 0;
      strip.scrollTo({ left: Math.max(0, left), behavior: smooth ? "smooth" : "instant" });
    });
  }

  // The panel plays its exit animation first; only then is the selection
  // dropped, so the side column / sheet collapses with its content still in it.
  // `fromHistory`: the Back button already popped the panel's history entry.
  // `animated: false`: the sheet was already swiped off-screen.
  _closePanel({ fromHistory = false, animated = true } = {}) {
    if (!this._selectedAreaId || this._closing) return;
    if (!fromHistory) this._popPanelHistory();
    this._closing = true;
    this._syncLayout();
    clearTimeout(this._closeTimer);
    const done = () => {
      this._closing = false;
      this._selectedAreaId = null;
      this._renderPanel();
      this._syncLayout();
    };
    if (animated) this._closeTimer = setTimeout(done, CLOSE_MS);
    else done();
  }

  // Opening the panel adds a history entry (same URL), so the phone's Back
  // button closes the panel instead of leaving the dashboard. Closing it any
  // other way removes that entry again.
  _pushPanelHistory() {
    if (history.state?.[PANEL_HISTORY_KEY]) return;
    history.pushState({ ...history.state, [PANEL_HISTORY_KEY]: true }, "");
  }

  _popPanelHistory() {
    if (!history.state?.[PANEL_HISTORY_KEY]) return;
    this._ignoreNextPop = true;
    history.back();
  }

  _syncLayout() {
    if (!this._root) return;
    const open = !!this._selectedAreaId;
    this._root.classList.toggle("has-sel", open);
    this._root.classList.toggle("closing", this._closing);
    for (const [areaId, ref] of this._orbRefs) {
      const sel = areaId === this._selectedAreaId;
      ref.tile.classList.toggle("sel", sel);
      ref.open.setAttribute("aria-pressed", String(sel));
    }
    // The header is a separate card; it reads these to keep its content
    // clear of the fixed side panel and aligned with the room grid.
    const docStyle = document.documentElement.style;
    // Kept through the exit slide, like the grid's column, so the header
    // makes room in the same single step as the grid.
    if (open) docStyle.setProperty("--atrium-panel-open", "1");
    else docStyle.removeProperty("--atrium-panel-open");
  }

  _render() {
    if (!this._hass) return;
    if (!this._root) this._buildShell();
    const floors = this._floorsData();
    const sig = floors.map((f) => f.floor.name + ":" + f.areas.map(({ area }) => `${area.area_id}/${area.name}/${area.picture || ""}/${area.icon || ""}`).join(",")).join(";");
    if (sig !== this._floorsSig) {
      this._floorsSig = sig;
      this._buildFloors(floors);
    } else {
      for (const f of floors) for (const { area, data } of f.areas) this._updateOrb(this._orbRefs.get(area.area_id), area, data);
      for (const ref of this._floorRefs) this._updateFloorLabel(ref);
    }
    if (this._selectedAreaId && !this._hass.areas?.[this._selectedAreaId]) {
      this._selectedAreaId = null;
      this._closing = false;
    }
    this._renderPanel();
    this._syncLayout();
  }

  _buildShell() {
    this.innerHTML = "";
    const styleEl = document.createElement("style");
    styleEl.textContent = STYLE;
    this.appendChild(styleEl);

    this._root = document.createElement("div");
    this._root.className = "atrium-rooms";
    this._content = document.createElement("div");
    this._content.className = "atrium-rooms-content";
    this._panel = document.createElement("aside");
    this._panel.className = "atrium-panel";
    this._bindRoomSwipe(this._panel);
    // Stepping rooms (swipe, arrow keys) from the very bottom of one lands at
    // the bottom of the next. That's remembered from the last room that
    // could scroll: a short room passed through on the way (nothing to
    // scroll, so no scroll event) doesn't reset it. Peeks don't count.
    this._panel.addEventListener("scroll", (e) => {
      if (e.target === this._pin && canScroll(this._pin)) this._stickBottom = atBottom(this._pin);
    }, true);
    this._root.append(this._content, this._panel);
    this.appendChild(this._root);
    this._resizeObserver = new ResizeObserver(() => this._sizeOrbs());
    this._resizeObserver.observe(this._content);
  }

  // Follows the content width continuously — including while the desktop
  // panel slides open — so the tiles always fill their row (see orb-grid.js).
  _sizeOrbs() {
    const style = getComputedStyle(this._content);
    const width = this._content.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (width <= 0) return;
    const { cols, gap, size } = orbGrid(width, this._maxAreasPerFloor);
    this._content.style.setProperty("--orb-cols", String(cols));
    this._content.style.setProperty("--orb-gap", `${gap}px`);
    this._content.style.setProperty("--orb-size", `${size}px`);
    this._content.style.setProperty("--orb-badge-font", `${orbBadgeFont(size)}px`);
  }

  _floorsData() {
    const out = [];
    for (const floor of this._floors) {
      const areas = [];
      for (const area of this._areasOnFloor(floor.floor_id ?? null)) {
        const data = this._dataForArea(area);
        if (!areaIsEmpty(data)) areas.push({ area, data });
      }
      if (areas.length) out.push({ floor, areas });
    }
    return out;
  }

  _buildFloors(floors) {
    this._orbRefs = new Map();
    this._floorRefs = [];
    this._maxAreasPerFloor = Math.max(0, ...floors.map((f) => f.areas.length));
    this._content.innerHTML = "";
    let index = 0;
    for (const f of floors) {
      const group = document.createElement("section");
      group.className = "atrium-floor-group";
      const row = document.createElement("div");
      row.className = "atrium-orb-row";
      for (const { area, data } of f.areas) row.appendChild(this._buildOrb(area, data, index++));
      group.append(this._buildFloorLabel(f), row);
      this._content.appendChild(group);
    }
    this._sizeOrbs();
  }

  // Floor heading: when the floor has lights, a toggle showing how many are
  // on (tap: all off, or all on when none is), then the floor icon and name.
  _buildFloorLabel({ floor, areas }) {
    const label = document.createElement("div");
    label.className = "atrium-floor-label";
    const lightIds = areas.flatMap(({ data }) => data.lights.map((l) => l.entity_id));
    if (lightIds.length) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "atrium-floor-toggle";
      toggle.innerHTML = `${haIcon("mdi:lightbulb-group")}<span class="atrium-floor-count"></span>`;
      toggle.addEventListener("click", () => toggleLights(this._hass, lightIds));
      label.appendChild(toggle);
      const ref = { floor, lightIds, count: toggle.lastChild, toggle };
      this._floorRefs.push(ref);
      this._updateFloorLabel(ref);
    }
    if (floor.icon) label.insertAdjacentHTML("beforeend", haIcon(floor.icon));
    const name = document.createElement("span");
    name.className = "atrium-floor-name";
    name.textContent = floor.name;
    label.append(name);
    return label;
  }

  _updateFloorLabel(ref) {
    const { on, total } = lightsSummary(this._hass, ref.lightIds);
    ref.count.textContent = `${on}/${total}`;
    ref.toggle.classList.toggle("on", on > 0);
    ref.toggle.setAttribute("aria-label", t("floorLightsAria", on, total, ref.floor.name));
  }

  _renderPanel({ freshPanel = false } = {}) {
    const areaId = this._selectedAreaId;
    const area = areaId ? this._hass.areas?.[areaId] : null;
    if (!area) {
      this._closeOpenPopovers();
      this._panel.innerHTML = "";
      this._panel.removeAttribute("aria-label");
      this._panelSig = null;
      this._panelAreaId = null;
      this._pin = null;
      return;
    }
    const data = this._dataForArea(area);
    const sig = areaPanelSignature(area, data);
    if (sig === this._panelSig && this._pin) {
      this._updatePanel(area, data);
      return;
    }
    // Only the panel itself slides in/out; its content just appears. A panel
    // opened from closed starts from a fresh, unscrolled container.
    this._panelSig = sig;
    this._panelAreaId = area.area_id;
    this._closeOpenPopovers();
    if (!this._pin || freshPanel) {
      this._panel.innerHTML = "";
      this._pin = document.createElement("div");
      this._pin.className = "atrium-panel-inner";
      const grabber = document.createElement("div");
      grabber.className = "atrium-sheet-grabber";
      this._bindSheetSwipe(grabber);
      this._panel.append(grabber, this._pin);
    }
    this._pin.innerHTML = "";
    this._pin.scrollTop = 0;
    this._panel.setAttribute("aria-label", area.name);
    this._fillPanel(this._pin, area, data);
  }

  // Builds a room's panel content into `pin`; the refs it registers (tiles,
  // hero, routines) become the live ones.
  _fillPanel(pin, area, data) {
    this._refs = {
      areas: new Map([[area.area_id, {
        lights: new Map(), switches: new Map(), covers: new Map(), media: new Map(),
        climates: new Map(), automations: new Map(), inputSelects: new Map(), sensors: new Map(),
      }]]),
      bulk: [],
    };
    this._routinesUI = null;
    pin.appendChild(this._buildHero(area, data));
    for (const section of this._buildRoomSections(area, data)) pin.appendChild(section);
  }

  // The panel of another room, built beside the open one (hidden from
  // assistive tech and taps) while a swipe leads to it. The open room's refs
  // stay the live ones until the peek is adopted. Like the open room, it
  // shows its bottom when the open room is scrolled all the way down.
  _buildPeek(areaId) {
    const area = this._hass.areas?.[areaId];
    if (!area || !this._pin) return null;
    const data = this._dataForArea(area);
    const live = [this._refs, this._heroRefs, this._routinesUI];
    const el = document.createElement("div");
    el.className = "atrium-panel-inner atrium-panel-peek";
    el.inert = true;
    el.setAttribute("aria-hidden", "true");
    this._fillPanel(el, area, data);
    const peek = { el, area, sig: areaPanelSignature(area, data), refs: this._refs, heroRefs: this._heroRefs, routinesUI: this._routinesUI };
    [this._refs, this._heroRefs, this._routinesUI] = live;
    this._panel.appendChild(el);
    if (this._stickBottom) el.scrollTop = el.scrollHeight;
    return peek;
  }

  // A swipe landed on the peeked room: its panel, already on screen, becomes
  // the open one as is, then catches up with any state change since it was
  // built.
  _adoptPeek(peek) {
    this._closeOpenPopovers();
    this._pin.remove();
    peek.el.classList.remove("atrium-panel-peek");
    peek.el.inert = false;
    peek.el.removeAttribute("aria-hidden");
    peek.el.style.transform = peek.el.style.opacity = "";
    this._pin = peek.el;
    [this._refs, this._heroRefs, this._routinesUI] = [peek.refs, peek.heroRefs, peek.routinesUI];
    this._selectedAreaId = this._panelAreaId = peek.area.area_id;
    this._panelSig = peek.sig;
    this._panel.setAttribute("aria-label", peek.area.name);
    this._renderPanel();
    this._syncLayout();
    this._revealSelected(peek.area.area_id, { smooth: true });
  }

  // Same entities as last render: refresh every tile where it stands so its
  // CSS transitions (fill height, thumb position, colors) animate.
  _updatePanel(area, data) {
    const refs = this._refs.areas.get(area.area_id);
    for (const key of ["lights", "switches", "covers"]) {
      for (const [entityId, ref] of refs[key]) {
        if (!this._dragState.has(entityId)) this._updateDivaRef(ref, entityId, ref.kind);
      }
    }
    for (const [entityId, ref] of refs.climates) this._updateClimateRef(ref, entityId);
    for (const [entityId, ref] of refs.media) this._updateMediaRef(ref, entityId);
    for (const [entityId, ref] of refs.automations) this._updateAutomationRef(ref, entityId);
    this._refreshRoutines(data);
    for (const [entityId, ref] of refs.inputSelects) this._updateInputSelectRef(ref, entityId);
    for (const ref of refs.sensors.values()) this._updateSensorRef(ref);
    for (const { btn, label } of this._refs.bulk) btn.textContent = label();
    this._heroRefs.photo.classList.toggle("gray", this._isDimmed(data));
    // Only swap the badges when what they say changed, so their icons don't
    // re-render (and flicker) on every unrelated state update.
    const badges = this._buildHeroBadges(area, data);
    const key = heroBadgesKey(badges);
    if (key !== this._heroRefs.key) {
      this._heroRefs.key = key;
      this._heroRefs.badges.replaceChildren(...badges);
    }
  }

  _bindRoomSwipe(panel) {
    panel.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch" || !this._selectedAreaId || this._closing || this._swiping) return;
      if (e.target.closest(SWIPE_IGNORE)) return;
      const x0 = e.clientX, y0 = e.clientY;
      let intent = null; // "swipe" | "other"
      let dx = 0;
      let samples = []; // recent [time, x], for the speed at release
      const peeks = new Map(); // areaId → peek, built on first sight
      let peek = null; // the one showing
      const pin = this._pin;
      const span = () => panel.clientWidth + PEEK_GAP;
      // The room a swipe in direction `dir` (1: next, -1: previous) leads to.
      const neighbour = (dir) => {
        const ids = [...this._orbRefs.keys()];
        const i = ids.indexOf(this._selectedAreaId);
        return i < 0 || ids.length < 2 ? null : ids[(i + dir + ids.length) % ids.length];
      };
      const place = () => {
        const dir = dx < 0 ? 1 : -1;
        const id = dx ? neighbour(dir) : null;
        if (id && !peeks.has(id)) peeks.set(id, this._buildPeek(id));
        peek = (id && peeks.get(id)) || null;
        for (const p of peeks.values()) if (p) p.el.style.visibility = p === peek ? "" : "hidden";
        if (peek) {
          const look = swipeLook(dx, span(), dir);
          Object.assign(pin.style, look.out);
          Object.assign(peek.el.style, look.in);
        } else {
          // A lone room has nowhere to go: it only gives a little.
          pin.style.transform = `translateX(${dx * 0.35}px)`;
        }
      };
      const onMove = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        dx = ev.clientX - x0;
        const dy = ev.clientY - y0;
        if (!intent) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_DECIDE) return;
          intent = Math.abs(dx) > Math.abs(dy) * 1.5 ? "swipe" : "other";
          if (intent === "other") return end();
          pin.style.willChange = "transform, opacity";
        }
        samples.push([ev.timeStamp, ev.clientX]);
        samples = samples.filter(([t]) => ev.timeStamp - t < 100);
        place();
      };
      const end = (ev) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        if (intent !== "swipe") return;
        // The lifted finger must not also tap whatever it started on; a click
        // only follows right away, so the guard expires on its own.
        const swallow = (c) => { c.stopPropagation(); c.preventDefault(); };
        panel.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => panel.removeEventListener("click", swallow, { capture: true }), 350);
        // Over the last 100 ms before the release: a finger that stopped
        // before lifting isn't a flick.
        const recent = samples.filter(([t]) => (ev?.timeStamp ?? 0) - t < 100);
        const [t1, x1] = recent[0] ?? [0, 0];
        const [t2, x2] = recent.at(-1) ?? [0, 0];
        const speed = t2 > t1 ? (x2 - x1) / (t2 - t1) : 0; // px/ms, signed
        const flick = Math.abs(speed) > SWIPE_STEP_SPEED && Math.sign(speed) === Math.sign(dx);
        const go = !!peek && ev?.type === "pointerup" && (Math.abs(dx) > panel.clientWidth * SWIPE_STEP_AT || flick);
        const dir = dx < 0 ? 1 : -1;
        const from = peek ? dx : dx * 0.35;
        const to = go ? -dir * span() : 0;
        // Carries on at the finger's speed, easing out; never slower than a
        // short settle.
        const duration = Math.min(320, Math.max(160, Math.abs(to - from) / Math.max(Math.abs(speed), 1.4)));
        // Slide, scale and fade all move in step with the offset, so each
        // keyframe pair is just the look at the release and at the end.
        const settle = (el, end) => {
          const anim = el.animate([{ transform: el.style.transform, opacity: el.style.opacity || "1" }, end], { duration, easing: "cubic-bezier(.2,.8,.2,1)" });
          Object.assign(el.style, end);
          return anim.finished.catch(() => {});
        };
        this._swiping = true;
        const look = peek && swipeLook(to, span(), dir);
        const moves = [settle(pin, look ? look.out : { transform: "translateX(0px)", opacity: "1" })];
        if (peek) moves.push(settle(peek.el, look.in));
        Promise.all(moves).then(() => {
          this._swiping = false;
          pin.style.willChange = "";
          for (const p of peeks.values()) if (p && !(go && p === peek)) p.el.remove();
          if (go && pin === this._pin && pin.isConnected && !this._closing) this._adoptPeek(peek);
          else {
            pin.style.transform = pin.style.opacity = "";
            if (go) peek.el.remove();
          }
        });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    });
  }

  // Phone bottom sheet: pulling its header (or grab bar) down drags the sheet
  // with the finger; let go past a quarter of its height, or with a quick
  // flick, and it closes — otherwise it springs back. The offset rides on
  // `translate`, separate from the `transform` the sheet's open/close
  // animations drive, so neither disturbs the other.
  _bindSheetSwipe(handle) {
    handle.addEventListener("pointerdown", (e) => {
      if (!matchMedia(SHEET_MEDIA).matches || this._closing || (this._pin?.scrollTop ?? 0) > 0) return;
      const panel = this._panel;
      const y0 = e.clientY;
      const t0 = e.timeStamp;
      let dy = 0;
      let dragging = false;
      const onMove = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        dy = Math.max(0, ev.clientY - y0);
        if (!dragging && dy > SWIPE_SLOP) {
          dragging = true;
          try { handle.setPointerCapture(e.pointerId); } catch (_) {}
          panel.style.transition = "none";
        }
        if (dragging) panel.style.translate = `0 ${dy}px`;
      };
      const onUp = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (!dragging) return;
        // The release shouldn't also count as a tap on a header badge.
        handle.addEventListener("click", (c) => c.stopPropagation(), { capture: true, once: true });
        const fast = dy / Math.max(1, ev.timeStamp - t0) > SWIPE_FLICK_SPEED;
        const far = dy > panel.offsetHeight * SWIPE_CLOSE_AT;
        const reset = () => { panel.style.transition = ""; panel.style.translate = ""; };
        if (ev.type !== "pointercancel" && (fast || far)) {
          panel.style.transition = "translate .22s cubic-bezier(.4,0,1,1)";
          panel.style.translate = "0 100%";
          setTimeout(() => { this._closePanel({ animated: false }); reset(); }, 220);
        } else {
          panel.style.transition = "translate .3s cubic-bezier(.32,.72,0,1)";
          panel.style.translate = "";
          setTimeout(reset, 300);
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  }

  _closeOpenPopovers() {
    for (const a of this._openAnchors) closePopoverFor(a);
    this._openAnchors.clear();
  }

  // A room reads dark when its lights are all off — or, with no lights to
  // go by, once the sun has set.
  _isDimmed(data) {
    if (!data.lights.length) return isNight(this._hass);
    return !data.lights.some((l) => this._hass.states?.[l.entity_id]?.state === "on");
  }

  // A tile is a container, not a button: its photo is the button that opens
  // the room, and each corner badge is its own button (a button can't hold
  // buttons). Clicking the name/meta below opens the room too.
  _buildOrb(area, data, index) {
    const tile = document.createElement("div");
    tile.className = "atrium-orb";
    tile.style.setProperty("--i", String(index));
    tile.addEventListener("click", (e) => {
      if (!e.target.closest(".atrium-orb-badge")) this._select(area.area_id);
    });

    const photo = document.createElement("div");
    photo.className = "atrium-orb-photo";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "atrium-orb-open";
    open.setAttribute("aria-label", area.name);
    const art = document.createElement("span");
    art.className = "atrium-orb-art" + (area.picture ? " has-img" : "");
    if (area.picture) art.style.backgroundImage = `url("${area.picture}")`;
    else art.innerHTML = haIcon(iconForArea(area));
    open.appendChild(art);

    const ref = { tile, open, meta: null, area, lightsOn: [], status: null, activity: null };
    const badge = (cls, onTap) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `atrium-orb-badge ${cls}`;
      b.hidden = true;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        onTap();
      });
      photo.appendChild(b);
      return b;
    };
    // A glow in the colors of the lights that are on, behind the photo.
    const aura = document.createElement("span");
    aura.className = "atrium-orb-aura";
    ref.aura = aura;
    photo.append(aura, open);
    ref.litBadge = badge("atrium-orb-badge-lit tl", () => {
      if (ref.lightsOn.length) this._call("light", "turn_off", { entity_id: ref.lightsOn });
    });
    ref.statusBadge = badge("atrium-orb-badge-status dot tr", () => ref.status && this._moreInfo(ref.status.entityId));
    ref.activityBadge = badge("atrium-orb-badge-activity dot br", () => {
      const act = ref.activity;
      if (!act) return;
      if (act.action) this._call(act.action[0], act.action[1], { entity_id: act.entityId });
      else this._moreInfo(act.entityId);
    });

    const name = document.createElement("span");
    name.className = "atrium-orb-name";
    name.textContent = area.name;
    const meta = document.createElement("span");
    meta.className = "atrium-orb-meta";
    ref.meta = meta;

    tile.append(photo, name, meta);
    this._orbRefs.set(area.area_id, ref);
    this._updateOrb(ref, area, data);
    return tile;
  }

  _updateOrb(ref, area, data) {
    const hass = this._hass;
    ref.lightsOn = data.lights.filter((l) => hass.states?.[l.entity_id]?.state === "on").map((l) => l.entity_id);
    const lightsOn = ref.lightsOn.length;
    ref.tile.classList.toggle("lit", lightsOn > 0);
    ref.tile.classList.toggle("gray", this._isDimmed(data));
    // Only which lights are on and their colors count, never brightness. The
    // aura keeps its last colors while it fades out with the lights.
    const aura = auraGradient(lightsAuraColors(hass, ref.lightsOn), { space: AURA_SPACE, hold: 0.6 });
    if (aura) ref.aura.style.setProperty("--aura", aura);
    ref.litBadge.hidden = lightsOn === 0;
    if (lightsOn > 0 && ref.litBadge.dataset.count !== String(lightsOn)) {
      ref.litBadge.dataset.count = String(lightsOn);
      ref.litBadge.innerHTML = `${haIcon("mdi:lightbulb-outline")}${lightsOn}`;
      ref.litBadge.setAttribute("aria-label", t("turnOffLightsIn", lightsOn, area.name));
    }

    const alert = areaAlert(hass, data);
    const status = areaStatusDot(areaPresence(hass, data), alert);
    ref.status = status;
    this._setDotBadge(ref.statusBadge, status, status && (status.kind === "presence" ? t("motionIn", area.name) : `${status.label} — ${area.name}`));
    for (const kind of ["presence", "alert", "warn"]) ref.statusBadge.classList.toggle(`is-${kind}`, status?.kind === kind);

    const activity = areaActivity(hass, data);
    ref.activity = activity;
    ref.activityBadge.classList.toggle("is-paused", activity?.kind === "media" && !activity.playing);
    this._setDotBadge(ref.activityBadge, activity, activity && ACTIVITY_LABEL[activity.kind](nameWithoutAreaPrefix(this._entityName(hass.entities?.[activity.entityId] || { entity_id: activity.entityId }), area)));
    for (const kind of Object.keys(ACTIVITY_LABEL)) ref.activityBadge.classList.toggle(`is-${kind}`, activity?.kind === kind);

    this._renderAreaMeta(ref.meta, area, data, alert);
  }

  _setDotBadge(el, info, label) {
    el.hidden = !info;
    if (!info) return;
    if (el.dataset.icon !== info.icon) {
      el.dataset.icon = info.icon;
      el.innerHTML = haIcon(info.icon);
    }
    el.setAttribute("aria-label", label);
  }

  // The line under a tile: temperature · humidity (or the alert), the
  // readings colored by comfort (see comfort-colors.js).
  _renderAreaMeta(el, area, data, alert) {
    const hass = this._hass;
    const tempSt = data.sensors.temp && hass.states?.[data.sensors.temp.entity_id];
    const climate = data.climates[0] && hass.states?.[data.climates[0].entity_id];
    const fromSensor = tempSt && tempSt.state !== "unavailable";
    const temp = fromSensor ? parseFloat(tempSt.state) : climate?.attributes?.current_temperature;
    const tempUnit = fromSensor ? tempSt.attributes?.unit_of_measurement : hass.config?.unit_system?.temperature;
    const humidSt = data.sensors.humid && hass.states?.[data.sensors.humid.entity_id];
    const humid = humidSt && humidSt.state !== "unavailable" ? Math.round(parseFloat(humidSt.state)) : null;
    const parts = areaMetaParts({ temp: Number.isFinite(temp) ? temp : null, humid: Number.isFinite(humid) ? humid : null, alert: alert?.label });
    const key = parts.map((p) => p.text).join(" · ");
    if (el.dataset.key === key && el.childNodes.length) return;
    el.dataset.key = key;
    if (!parts.length) {
      el.textContent = "\u00a0";
      return;
    }
    const nodes = [];
    parts.forEach((p, i) => {
      if (i) nodes.push(document.createTextNode(" · "));
      const span = document.createElement("span");
      span.textContent = p.text;
      if (p.kind === "temp") span.style.color = tempColor(toCelsius(p.value, tempUnit));
      else if (p.kind === "humid") span.style.color = humidityColor(p.value);
      nodes.push(span);
    });
    el.replaceChildren(...nodes);
  }


  _buildHero(area, data) {
    const hero = document.createElement("div");
    hero.className = "atrium-panel-hero";

    // With lights in the room, the photo is a button that turns them all on.
    const hasLights = data.lights.length > 0;
    const photo = document.createElement(hasLights ? "button" : "span");
    photo.className = "atrium-panel-hero-photo" + (this._isDimmed(data) ? " gray" : "");
    if (hasLights) {
      photo.type = "button";
      photo.setAttribute("aria-label", t("turnOnAllLightsIn", area.name));
      photo.addEventListener("click", () => {
        const ids = this._dataForArea(area).lights.map((l) => l.entity_id).filter((id) => this._hass.states?.[id]?.state !== "unavailable");
        if (ids.length) this._allLightsOn(ids);
      });
    }
    const art = document.createElement("span");
    art.className = "atrium-orb-art" + (area.picture ? " has-img" : "");
    if (area.picture) art.style.backgroundImage = `url("${area.picture}")`;
    else art.innerHTML = haIcon(iconForArea(area), 26);
    photo.appendChild(art);

    const mid = document.createElement("div");
    mid.className = "atrium-panel-hero-mid";
    const name = document.createElement("h2");
    name.className = "atrium-panel-hero-name";
    name.textContent = area.name;
    const badges = document.createElement("div");
    badges.className = "atrium-panel-hero-badges";
    badges.append(...this._buildHeroBadges(area, data));
    mid.append(name, badges);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "atrium-panel-close";
    close.setAttribute("aria-label", t("closeName", area.name));
    close.innerHTML = haIcon("mdi:close", 18);
    close.addEventListener("click", () => this._select(null));

    hero.append(photo, mid, close);
    this._bindSheetSwipe(hero);
    this._heroRefs = { photo, badges, key: heroBadgesKey([...badges.children]) };
    return hero;
  }

  _buildHeroBadges(area, data) {
    const hass = this._hass;
    const badges = [];
    const add = (icon, text, tone, entityId, color, onClick) => {
      const el = document.createElement(entityId ? "button" : "span");
      if (entityId) el.type = "button";
      el.className = "atrium-badge" + (tone ? ` is-${tone}` : "");
      if (color) {
        el.style.color = color;
        el.style.background = `color-mix(in srgb, ${color} 14%, transparent)`;
      }
      el.innerHTML = `${haIcon(icon, 13)}<span></span>`;
      el.querySelector("span").textContent = text;
      if (entityId) el.addEventListener("click", () => (onClick ? onClick(el) : this._moreInfo(entityId)));
      badges.push(el);
      return el;
    };

    if (data.sensors.temp) {
      const st = hass.states?.[data.sensors.temp.entity_id];
      const v = parseFloat(st?.state);
      if (st && st.state !== "unavailable" && Number.isFinite(v)) add("mdi:thermometer", `${v.toFixed(1)}°`, null, data.sensors.temp.entity_id, tempColor(toCelsius(v, st.attributes?.unit_of_measurement)));
    }
    if (data.sensors.humid) {
      const st = hass.states?.[data.sensors.humid.entity_id];
      const v = Math.round(parseFloat(st?.state));
      if (st && st.state !== "unavailable" && Number.isFinite(v)) add("mdi:water-percent", `${v}%`, null, data.sensors.humid.entity_id, humidityColor(v));
    }
    // Soil moisture and tank levels, as the pre-redesign area chips showed
    // them: a plant in green, a propane tank colored by how full it is.
    const percent = (e) => {
      const st = hass.states?.[e.entity_id];
      const v = parseFloat(st?.state);
      return st && st.state !== "unavailable" && Number.isFinite(v) ? Math.round(v) : null;
    };
    for (const s of data.sensors.soil) {
      const pct = percent(s);
      if (pct != null) add(ICONS.plant, `${pct}%`, "good", s.entity_id);
    }
    for (const p of data.sensors.propane) {
      const pct = percent(p);
      if (pct != null) add(ICONS.propane, `${pct}%`, levelTone(pct), p.entity_id);
    }
    // Motion, leak, openings and vacuums: each active one gets a labelled
    // badge; the quiet rest of a kind fold into one icon-only badge (with a
    // count when there are several) so they stay one tap away.
    const isOn = (e) => hass.states?.[e.entity_id]?.state === "on";
    const name = (e) => nameWithoutAreaPrefix(this._entityName(e), area);
    const activeMotion = data.sensors.motion.filter(isOn);
    if (activeMotion.length) add("mdi:motion-sensor", t("motion"), "info", activeMotion[0].entity_id);
    const activeLeak = data.sensors.leak.filter(isOn);
    if (activeLeak.length) add("mdi:water-alert", t("leak"), "alert", activeLeak[0].entity_id);
    const openDoors = data.doors.filter(isOn);
    for (const d of openDoors) add("mdi:door-open", name(d), "warn", d.entity_id);
    for (const s of [...data.sensors.other]) {
      const st = hass.states?.[s.entity_id];
      if (st?.attributes?.device_class === "problem" && st.state === "on") add("mdi:alert-circle", name(s), "alert", s.entity_id);
    }
    const isCleaning = (v) => ["cleaning", "returning"].includes(hass.states?.[v.entity_id]?.state);
    const cleaning = data.vacuums.filter(isCleaning);
    // Green like the tile's spinning vacuum badge.
    for (const v of cleaning) add("mdi:robot-vacuum", name(v), "good", v.entity_id);

    const quiet = (icon, label, entities) => {
      if (!entities.length) return;
      const several = entities.length > 1;
      const el = add(icon, several ? String(entities.length) : "", null, entities[0].entity_id, null, several ? (anchor) => this._openQuietBadge(anchor, icon, label, entities, name) : null);
      el.classList.add("is-quiet");
      el.setAttribute("aria-label", several ? `${label}: ${entities.length}` : `${label}: ${name(entities[0])}`);
    };
    if (!activeMotion.length) quiet("mdi:motion-sensor", t("motionSensors"), data.sensors.motion);
    if (!activeLeak.length) quiet("mdi:water-check", t("leakSensors"), data.sensors.leak);
    quiet("mdi:door-closed", t("doorsWindows"), data.doors.filter((d) => !isOn(d)));
    quiet("mdi:robot-vacuum", t("vacuums"), data.vacuums.filter((v) => !isCleaning(v)));
    return badges;
  }

  // A quiet badge standing for several entities lists them, each opening its details.
  _openQuietBadge(anchor, icon, label, entities, name) {
    ensurePopoverItemStyle();
    this._openAnchors.add(anchor);
    openListPopover({
      anchor,
      title: label,
      countLabel: String(entities.length),
      items: entities,
      buildItem: (e) => {
        const st = this._hass.states?.[e.entity_id];
        const row = document.createElement("button");
        row.type = "button";
        row.className = "atrium-reading";
        row.innerHTML = `${haIcon(st?.attributes?.icon || icon)}<span class="atrium-reading-name"></span><span class="atrium-reading-value"></span>`;
        row.firstElementChild.classList.add("atrium-reading-icon");
        row.querySelector(".atrium-reading-name").textContent = name(e);
        row.querySelector(".atrium-reading-value").textContent = st ? this._hass.formatEntityState?.(st) ?? st.state : "—";
        row.addEventListener("click", () => this._moreInfo(e.entity_id));
        return row;
      },
      listClass: "atrium-pop-list-sensors",
      width: 280,
      onClose: () => this._openAnchors.delete(anchor),
    });
  }
}

Object.assign(AtriumRooms.prototype, buildersMod, updatersMod);

customElements.define("atrium-rooms", AtriumRooms);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "atrium-rooms",
  name: "Atrium Rooms",
  description: "Every floor and area as photo tiles, opening a details panel (side panel on desktop, bottom sheet on phone) with swipe-to-dim tiles, climate, scenes and automations.",
});
