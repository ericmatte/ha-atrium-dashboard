// `set hass()` fires on every state change. The DOM is never torn down on a
// state change: orbs and the open panel's tiles are updated in place, since
// the design leans on CSS transitions (panel slide, orb resize, track fills)
// that a rebuilt element would skip. Only a change in *which* areas/entities
// are shown rebuilds the floors or the panel content.

import { closePopoverFor } from "../lib/popover.js";
import { sameRegistries, unchangedStates, areaIdForEntity, entityDisplayName } from "../lib/hass-utils.js";
import { fireMoreInfo, haIcon } from "../lib/dom-utils.js";
import { callService, toggleLights } from "../lib/ha-actions.js";
import { STYLE, iconForArea, fmtCoverPct } from "./area-card-shared.js";
import {
  entitiesForArea,
  hiddenRoutinesForArea,
  classifyAreaEntities,
  areaIsEmpty,
  areaAlert,
  areaMetaLine,
  areaPanelSignature,
} from "../lib/area-data.js";
import * as buildersMod from "./area-card-builders.js";
import * as updatersMod from "./area-card-updaters.js";
import { subscribeLabelsLoaded } from "../lib/label-registry.js";
import { orbGrid } from "../lib/orb-grid.js";

// Matches the design's exit animations (pinOut .24s / sheetOut .28s) so the
// selection is only dropped once they've played.
const CLOSE_MS = 280;

class AtriumRooms extends HTMLElement {
  constructor() {
    super();
    this._dragState = new Map();
    this._openAnchors = new Set();
    this._selectedAreaId = null;
    this._closing = false;
    this._orbRefs = new Map();
    this._lastClimateMode = new Map();
  }

  setConfig(config) {
    // Floors in display order, as strategy.js computed them (real HA floors
    // sorted, plus the virtual "Other" floor for orphan areas).
    if (!Array.isArray(config.floors)) throw new Error("floors is required");
    this._floors = config.floors;
  }

  connectedCallback() {
    this.style.display = "block";
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
      if (ent.hidden) continue;
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
    const data = classifyAreaEntities(hass, area, entities);
    data.hiddenRoutines = hiddenRoutinesForArea(hass, area);
    return data;
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
    this._renderPanel({ replayPanelIn: reopening });
    this._syncLayout();
  }

  // The panel plays its exit animation first; only then is the selection
  // dropped, so the side column / sheet collapses with its content still in it.
  _closePanel() {
    if (!this._selectedAreaId || this._closing) return;
    this._closing = true;
    this._syncLayout();
    clearTimeout(this._closeTimer);
    this._closeTimer = setTimeout(() => {
      this._closing = false;
      this._selectedAreaId = null;
      this._renderPanel();
      this._syncLayout();
    }, CLOSE_MS);
  }

  _syncLayout() {
    if (!this._root) return;
    const open = !!this._selectedAreaId;
    this._root.classList.toggle("has-sel", open);
    this._root.classList.toggle("closing", this._closing);
    for (const [areaId, ref] of this._orbRefs) {
      const sel = areaId === this._selectedAreaId;
      ref.btn.classList.toggle("sel", sel);
      ref.btn.setAttribute("aria-pressed", String(sel));
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
    this._maxAreasPerFloor = Math.max(0, ...floors.map((f) => f.areas.length));
    this._content.innerHTML = "";
    let index = 0;
    for (const { floor, areas } of floors) {
      const group = document.createElement("section");
      group.className = "atrium-floor-group";
      const label = document.createElement("div");
      label.className = "atrium-floor-name";
      label.textContent = floor.name;
      const row = document.createElement("div");
      row.className = "atrium-orb-row";
      for (const { area, data } of areas) row.appendChild(this._buildOrb(area, data, index++));
      group.append(label, row);
      this._content.appendChild(group);
    }
    this._sizeOrbs();
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
      this._panel.appendChild(this._pin);
    }
    this._pin.classList.toggle("settled", !replayPanelIn);
    this._pin.innerHTML = "";
    this._pin.scrollTop = 0;
    this._panel.setAttribute("aria-label", area.name);
    this._refs = {
      areas: new Map([[area.area_id, {
        lights: new Map(), switches: new Map(), covers: new Map(),
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
    for (const [entityId, ref] of refs.automations) this._updateAutomationRef(ref, entityId);
    for (const [entityId, ref] of refs.inputSelects) this._updateInputSelectRef(ref, entityId);
    for (const ref of refs.sensors.values()) this._updateSensorRef(ref);
    for (const { btn, label } of this._refs.bulk) btn.textContent = label();
    this._heroRefs.photo.classList.toggle("gray", this._allLightsOff(data));
    this._heroRefs.badges.replaceChildren(...this._buildHeroBadges(area, data));
  }

  _closeOpenPopovers() {
    for (const a of this._openAnchors) closePopoverFor(a);
    this._openAnchors.clear();
  }

  _allLightsOff(data) {
    return data.lights.length > 0 && !data.lights.some((l) => this._hass.states?.[l.entity_id]?.state === "on");
  }

  _buildOrb(area, data, index) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "atrium-orb";
    btn.style.setProperty("--i", String(index));
    btn.addEventListener("click", () => this._select(area.area_id));

    const photo = document.createElement("span");
    photo.className = "atrium-orb-photo";
    const art = document.createElement("span");
    art.className = "atrium-orb-art" + (area.picture ? " has-img" : "");
    if (area.picture) art.style.backgroundImage = `url("${area.picture}")`;
    else art.innerHTML = haIcon(iconForArea(area));
    const litBadge = document.createElement("span");
    litBadge.className = "atrium-orb-badge-lit";
    const alertBadge = document.createElement("span");
    alertBadge.className = "atrium-orb-badge-alert";
    photo.append(art, litBadge, alertBadge);

    const name = document.createElement("span");
    name.className = "atrium-orb-name";
    name.textContent = area.name;
    const meta = document.createElement("span");
    meta.className = "atrium-orb-meta";

    btn.append(photo, name, meta);
    const ref = { btn, litBadge, alertBadge, meta };
    this._orbRefs.set(area.area_id, ref);
    this._updateOrb(ref, area, data);
    return btn;
  }

  _updateOrb(ref, area, data) {
    const lightsOn = data.lights.filter((l) => this._hass.states?.[l.entity_id]?.state === "on").length;
    ref.btn.classList.toggle("lit", lightsOn > 0);
    ref.btn.classList.toggle("gray", this._allLightsOff(data));
    ref.litBadge.hidden = lightsOn === 0;
    if (lightsOn > 0 && ref.litBadge.dataset.count !== String(lightsOn)) {
      ref.litBadge.dataset.count = String(lightsOn);
      ref.litBadge.innerHTML = `${haIcon("mdi:lightbulb-outline", 13)}${lightsOn}`;
    }
    const alert = areaAlert(this._hass, data);
    ref.alertBadge.hidden = !alert;
    if (alert && ref.alertBadge.dataset.icon !== alert.icon) {
      ref.alertBadge.dataset.icon = alert.icon;
      ref.alertBadge.innerHTML = haIcon(alert.icon, 14);
    }
    ref.meta.textContent = this._areaMeta(area, data, alert) || "\u00a0";
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
    this._heroRefs = { photo, badges };
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
    const activeMotion = data.sensors.motion.find((s) => hass.states?.[s.entity_id]?.state === "on");
    if (activeMotion) add("mdi:motion-sensor", "Motion", "info", activeMotion.entity_id);
    const activeLeak = data.sensors.leak.find((s) => hass.states?.[s.entity_id]?.state === "on");
    if (activeLeak) add("mdi:water-alert", "Leak!", "alert", activeLeak.entity_id);
    for (const d of data.doors) {
      const st = hass.states?.[d.entity_id];
      if (st?.state === "on") add("mdi:door-open", this._entityName(d), "warn", d.entity_id);
    }
    for (const s of [...data.sensors.other]) {
      const st = hass.states?.[s.entity_id];
      if (st?.attributes?.device_class === "problem" && st.state === "on") add("mdi:alert-circle", this._entityName(s), "alert", s.entity_id);
    }
    for (const v of data.vacuums) {
      const st = hass.states?.[v.entity_id];
      if (st?.state === "cleaning" || st?.state === "returning") add("mdi:robot-vacuum", this._entityName(v), "info", v.entity_id);
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
