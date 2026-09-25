// `set hass()` fires on every state change. The DOM is never torn down on a
// state change: orbs and the open panel's tiles are updated in place, since
// the design leans on CSS transitions (panel slide, orb resize, track fills)
// that a rebuilt element would skip. Only a change in *which* areas/entities
// are shown rebuilds the floors or the panel content.

import { closePopoverFor } from "../lib/popover.js";
import { sameRegistries, unchangedStates, areaIdForEntity, entityDisplayName } from "../lib/hass-utils.js";
import { fireMoreInfo, haIcon } from "../lib/dom-utils.js";
import { callService, toggleLights } from "../lib/ha-actions.js";
import { STYLE, ICONS, iconForArea, fmtCoverPct, nameWithoutAreaPrefix } from "./area-card-shared.js";
import {
  entitiesForArea,
  isShownEntity,
  classifyAreaEntities,
  areaIsEmpty,
  areaAlert,
  areaPresence,
  areaActivity,
  areaStatusDot,
  areaMetaLine,
  lightsSummary,
  levelTone,
  areaPanelSignature,
} from "../lib/area-data.js";
import * as buildersMod from "./area-card-builders.js";
import * as updatersMod from "./area-card-updaters.js";
import { subscribeLabelsLoaded } from "../lib/label-registry.js";
import { orbGrid, orbBadgeFont } from "../lib/orb-grid.js";

// Matches the design's exit animations (pinOut .24s / sheetOut .28s) so the
// selection is only dropped once they've played.
const CLOSE_MS = 280;
const PANEL_HISTORY_KEY = "atriumPanel";
// Must match the phone breakpoint in area-card.css.
const SHEET_MEDIA = "(max-width: 860px)";
const SWIPE_SLOP = 6;
const SWIPE_CLOSE_AT = 0.25;
const SWIPE_FLICK_SPEED = 0.6; // px/ms

const heroBadgesKey = (els) => els.map((b) => `${b.className}|${b.textContent}|${b.querySelector("ha-icon")?.getAttribute("icon")}`).join(";");

// Screen-reader label of the bottom-right "what's running" badge, by kind.
const ACTIVITY_LABEL = {
  media: (name) => `Play/pause ${name}`,
  vacuum: (name) => `Pause ${name}`,
  heating: (name) => `${name} heating`,
  cooling: (name) => `${name} cooling`,
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
    this._routineDrawers = new Map();
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
    this._onKeydown = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented || !this._selectedAreaId) return;
      if (document.querySelector(".atrium-pop")) return;
      this._select(null);
    };
  }

  setConfig(config) {
    // Floors in display order, as strategy.js computed them (real HA floors
    // sorted, plus the virtual "Other" floor for orphan areas).
    if (!Array.isArray(config.floors)) throw new Error("floors is required");
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
    if (registriesChanged) this._panelSig = null;
    if (!this._root || registriesChanged || statesChanged) this._render();
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

  _toggleAllLights(lights) {
    if (!lights.length) return;
    toggleLights(this._hass, lights.map((l) => l.entity_id));
  }

  _toggleAllCovers(covers) {
    if (!covers.length) return;
    const ids = covers.map((c) => c.entity_id);
    const anyOpen = ids.some((id) => fmtCoverPct(this._hass.states?.[id] || { attributes: {} }) > 5);
    this._call("cover", anyOpen ? "close_cover" : "open_cover", { entity_id: ids });
  }

  // direction is -1 or +1: the size of the move belongs to the device, not
  // to us. A 1°C heat pump silently ignores 0.5° setpoints a thermostat takes.
  _adjustClimate(entityId, direction) {
    const st = this._hass.states?.[entityId];
    if (!st) return;
    const cur = st.attributes?.temperature;
    if (cur == null) return;
    const step = Number(st.attributes?.target_temp_step) || 0.5;
    const min = Number(st.attributes?.min_temp ?? -Infinity);
    const max = Number(st.attributes?.max_temp ?? Infinity);
    const snapped = Math.round((cur + direction * step) / step) * step;
    const next = Math.min(max, Math.max(min, Number(snapped.toFixed(2))));
    if (next === cur) return;
    this._call("climate", "set_temperature", { entity_id: entityId, temperature: next });
  }

  // Tapping the open room again, the close button, or another room while
  // closing all route through here; `null` closes.
  _select(areaId) {
    if (areaId == null || areaId === this._selectedAreaId) this._closePanel();
    else this._openPanel(areaId);
  }

  _openPanel(areaId) {
    clearTimeout(this._closeTimer);
    const reopening = !this._selectedAreaId || this._closing;
    this._closing = false;
    this._selectedAreaId = areaId;
    if (reopening) this._pushPanelHistory();
    this._renderPanel({ replayPanelIn: reopening });
    this._syncLayout();
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
    if (open && !this._closing) docStyle.setProperty("--atrium-panel-open", "1");
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
    ref.toggle.setAttribute("aria-label", `${on} of ${total} ${ref.floor.name} lights on — turn ${on > 0 ? "off" : "on"}`);
  }

  _renderPanel({ replayPanelIn = false } = {}) {
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
    // Sections slide in only when the panel first opens; switching rooms or
    // a rebuild (an entity was added/removed) swaps the content in place.
    this._panelSig = sig;
    this._panelAreaId = area.area_id;
    this._closeOpenPopovers();
    if (!this._pin || replayPanelIn) {
      this._panel.innerHTML = "";
      this._pin = document.createElement("div");
      this._pin.className = "atrium-panel-inner";
      const grabber = document.createElement("div");
      grabber.className = "atrium-sheet-grabber";
      this._bindSheetSwipe(grabber);
      this._panel.append(grabber, this._pin);
    }
    this._pin.classList.toggle("settled", !replayPanelIn);
    this._pin.innerHTML = "";
    this._pin.scrollTop = 0;
    this._panel.setAttribute("aria-label", area.name);
    this._refs = {
      areas: new Map([[area.area_id, {
        lights: new Map(), switches: new Map(), covers: new Map(), media: new Map(),
        climates: new Map(), automations: new Map(), inputSelects: new Map(), sensors: new Map(),
      }]]),
      bulk: [],
    };
    this._pin.appendChild(this._buildHero(area, data));
    for (const section of this._buildRoomSections(area, data)) this._pin.appendChild(section);
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
    this._heroRefs.photo.classList.toggle("gray", this._allLightsOff(data));
    // Only swap the badges when what they say changed, so their icons don't
    // re-render (and flicker) on every unrelated state update.
    const badges = this._buildHeroBadges(area, data);
    const key = heroBadgesKey(badges);
    if (key !== this._heroRefs.key) {
      this._heroRefs.key = key;
      this._heroRefs.badges.replaceChildren(...badges);
    }
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

  _allLightsOff(data) {
    return data.lights.length > 0 && !data.lights.some((l) => this._hass.states?.[l.entity_id]?.state === "on");
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
    photo.appendChild(open);
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
    ref.tile.classList.toggle("gray", this._allLightsOff(data));
    ref.litBadge.hidden = lightsOn === 0;
    if (lightsOn > 0 && ref.litBadge.dataset.count !== String(lightsOn)) {
      ref.litBadge.dataset.count = String(lightsOn);
      ref.litBadge.innerHTML = `${haIcon("mdi:lightbulb-outline")}${lightsOn}`;
      ref.litBadge.setAttribute("aria-label", `Turn off ${lightsOn} ${lightsOn === 1 ? "light" : "lights"} in ${area.name}`);
    }

    const alert = areaAlert(hass, data);
    const status = areaStatusDot(areaPresence(hass, data), alert);
    ref.status = status;
    this._setDotBadge(ref.statusBadge, status, status && (status.kind === "presence" ? `Motion in ${area.name}` : `${status.label} — ${area.name}`));
    for (const kind of ["presence", "alert", "warn"]) ref.statusBadge.classList.toggle(`is-${kind}`, status?.kind === kind);

    const activity = areaActivity(hass, data);
    ref.activity = activity;
    ref.activityBadge.classList.toggle("is-paused", activity?.kind === "media" && !activity.playing);
    this._setDotBadge(ref.activityBadge, activity, activity && ACTIVITY_LABEL[activity.kind](nameWithoutAreaPrefix(this._entityName(hass.entities?.[activity.entityId] || { entity_id: activity.entityId }), area)));
    for (const kind of Object.keys(ACTIVITY_LABEL)) ref.activityBadge.classList.toggle(`is-${kind}`, activity?.kind === kind);

    ref.meta.textContent = this._areaMeta(area, data, alert) || " ";
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

  _areaMeta(area, data, alert) {
    const tempSt = data.sensors.temp && this._hass.states?.[data.sensors.temp.entity_id];
    const climate = data.climates[0] && this._hass.states?.[data.climates[0].entity_id];
    const temp = tempSt && tempSt.state !== "unavailable" ? parseFloat(tempSt.state) : climate?.attributes?.current_temperature;
    const humidSt = data.sensors.humid && this._hass.states?.[data.sensors.humid.entity_id];
    const humid = humidSt && humidSt.state !== "unavailable" ? Math.round(parseFloat(humidSt.state)) : null;
    return areaMetaLine({ temp: Number.isFinite(temp) ? temp : null, humid: Number.isFinite(humid) ? humid : null, alert: alert?.label });
  }

  _buildHero(area, data) {
    const hero = document.createElement("div");
    hero.className = "atrium-panel-hero";

    const photo = document.createElement("span");
    photo.className = "atrium-panel-hero-photo" + (this._allLightsOff(data) ? " gray" : "");
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
    close.setAttribute("aria-label", `Close ${area.name}`);
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
    const add = (icon, text, tone, entityId) => {
      const el = document.createElement(entityId ? "button" : "span");
      if (entityId) el.type = "button";
      el.className = "atrium-badge" + (tone ? ` is-${tone}` : "");
      el.innerHTML = `${haIcon(icon, 13)}<span></span>`;
      el.querySelector("span").textContent = text;
      if (entityId) el.addEventListener("click", () => this._moreInfo(entityId));
      badges.push(el);
    };

    if (data.sensors.temp) {
      const st = hass.states?.[data.sensors.temp.entity_id];
      if (st && st.state !== "unavailable") add("mdi:thermometer", `${parseFloat(st.state).toFixed(1)}°`, null, data.sensors.temp.entity_id);
    }
    if (data.sensors.humid) {
      const st = hass.states?.[data.sensors.humid.entity_id];
      if (st && st.state !== "unavailable") add("mdi:water-percent", `${Math.round(parseFloat(st.state))}%`, null, data.sensors.humid.entity_id);
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
    const activeMotion = data.sensors.motion.find((s) => hass.states?.[s.entity_id]?.state === "on");
    if (activeMotion) add("mdi:motion-sensor", "Motion", "info", activeMotion.entity_id);
    const activeLeak = data.sensors.leak.find((s) => hass.states?.[s.entity_id]?.state === "on");
    if (activeLeak) add("mdi:water-alert", "Leak!", "alert", activeLeak.entity_id);
    for (const d of data.doors) {
      const st = hass.states?.[d.entity_id];
      if (st?.state === "on") add("mdi:door-open", nameWithoutAreaPrefix(this._entityName(d), area), "warn", d.entity_id);
    }
    for (const s of [...data.sensors.other]) {
      const st = hass.states?.[s.entity_id];
      if (st?.attributes?.device_class === "problem" && st.state === "on") add("mdi:alert-circle", nameWithoutAreaPrefix(this._entityName(s), area), "alert", s.entity_id);
    }
    for (const v of data.vacuums) {
      const st = hass.states?.[v.entity_id];
      // Green like the tile's spinning vacuum badge.
      if (st?.state === "cleaning" || st?.state === "returning") add("mdi:robot-vacuum", nameWithoutAreaPrefix(this._entityName(v), area), "good", v.entity_id);
    }
    return badges;
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
