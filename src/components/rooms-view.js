// `set hass()` fires on every state change. A full `_build()` only runs when
// the registries changed or a relevant entity's state actually moved
// (`_relevantIds`/`unchangedStates`) — see area-card-builders.js/
// area-card-updaters.js for why a full rebuild is cheap here: at most one
// room's content is ever on screen at a time, so there's no need for the
// old accordion's per-tile incremental refresh.

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
  areaHasAlert,
} from "../lib/area-data.js";
import * as buildersMod from "./area-card-builders.js";
import * as updatersMod from "./area-card-updaters.js";
import { subscribeLabelsLoaded } from "../lib/label-registry.js";

class AtriumRooms extends HTMLElement {
  constructor() {
    super();
    this._dragState = new Map();
    this._openAnchors = new Set();
    this._selectedAreaId = null;
  }

  setConfig(config) {
    // Floors in display order, as strategy.js computed them (real HA floors
    // sorted, plus the virtual "Other" floor for orphan areas).
    if (!Array.isArray(config.floors)) throw new Error("floors is required");
    this._floors = config.floors;
  }

  connectedCallback() {
    this.style.display = "block";
    this._unsubLabels = subscribeLabelsLoaded(() => this._build());
  }

  disconnectedCallback() {
    for (const a of this._openAnchors) closePopoverFor(a);
    this._openAnchors.clear();
    this._unsubLabels?.();
    this._unsubLabels = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) {
      this._built = true;
      this._build();
      return;
    }
    if (this._dragState.size) return; // a pointer gesture owns the visuals
    const registriesChanged = !sameRegistries(this, "_reg", hass);
    if (registriesChanged || !unchangedStates(this, "_stateSnap", hass, this._relevantIds())) {
      this._build();
    }
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

  _select(areaId) {
    this._selectedAreaId = this._selectedAreaId === areaId ? null : areaId;
    this._build();
  }

  _build() {
    if (!this._hass) return;
    for (const a of this._openAnchors) closePopoverFor(a);
    this._openAnchors.clear();

    this.innerHTML = "";
    const styleEl = document.createElement("style");
    styleEl.textContent = STYLE;
    this.appendChild(styleEl);

    const selected = this._selectedAreaId ? this._hass.areas?.[this._selectedAreaId] : null;

    const root = document.createElement("div");
    root.className = "atrium-rooms" + (selected ? " has-sel" : "");
    this._refs = { areas: new Map() };

    const content = document.createElement("div");
    content.className = "atrium-rooms-content";
    for (const floor of this._floors) {
      const areas = this._areasOnFloor(floor.floor_id ?? null);
      const rendered = [];
      for (const area of areas) {
        const data = this._dataForArea(area);
        if (areaIsEmpty(data)) continue;
        rendered.push(this._buildOrb(area, data));
      }
      if (!rendered.length) continue;
      const group = document.createElement("div");
      group.className = "atrium-floor-group";
      const label = document.createElement("div");
      label.className = "atrium-floor-name";
      label.textContent = floor.name;
      const row = document.createElement("div");
      row.className = "atrium-orb-row";
      row.append(...rendered);
      group.append(label, row);
      content.appendChild(group);
    }
    root.appendChild(content);

    const scrim = document.createElement("div");
    scrim.className = "atrium-panel-scrim" + (selected ? " open" : "");
    scrim.addEventListener("click", () => this._select(null));
    root.appendChild(scrim);

    const panel = document.createElement("aside");
    panel.className = "atrium-panel" + (selected ? " open" : "");
    if (selected) {
      const data = this._dataForArea(selected);
      const inner = document.createElement("div");
      inner.className = "atrium-panel-inner";
      inner.appendChild(this._buildHero(selected, data));
      for (const section of this._buildRoomSections(selected, data)) inner.appendChild(section);
      panel.appendChild(inner);
    }
    root.appendChild(panel);

    this.appendChild(root);
  }

  _buildOrb(area, data) {
    const lightsOn = data.lights.filter((l) => this._hass.states?.[l.entity_id]?.state === "on").length;
    const alert = areaHasAlert(this._hass, data);
    const selected = this._selectedAreaId === area.area_id;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "atrium-orb" + (lightsOn > 0 ? " lit" : "") + (lightsOn === 0 && data.lights.length ? " gray" : "") + (selected ? " sel" : "");
    btn.setAttribute("aria-pressed", String(selected));
    btn.addEventListener("click", () => this._select(area.area_id));

    const photo = document.createElement("span");
    photo.className = "atrium-orb-photo";
    const art = document.createElement("span");
    art.className = "atrium-orb-art" + (area.picture ? " has-img" : "");
    if (area.picture) art.style.backgroundImage = `url("${area.picture}")`;
    else art.innerHTML = haIcon(iconForArea(area));
    photo.appendChild(art);
    if (lightsOn > 0) {
      const badge = document.createElement("span");
      badge.className = "atrium-orb-badge-lit";
      badge.innerHTML = `${haIcon("mdi:lightbulb", 12)}${lightsOn}`;
      photo.appendChild(badge);
    }
    if (alert) {
      const badge = document.createElement("span");
      badge.className = "atrium-orb-badge-alert";
      badge.innerHTML = haIcon("mdi:alert", 12);
      photo.appendChild(badge);
    }

    const name = document.createElement("span");
    name.className = "atrium-orb-name";
    name.textContent = area.name;

    const meta = document.createElement("span");
    meta.className = "atrium-orb-meta";
    meta.textContent = this._areaMeta(area, data);

    btn.append(photo, name, meta);
    return btn;
  }

  _areaMeta(area, data) {
    const tempSt = data.sensors.temp && this._hass.states?.[data.sensors.temp.entity_id];
    const climate = data.climates[0] && this._hass.states?.[data.climates[0].entity_id];
    const temp = tempSt && tempSt.state !== "unavailable" ? parseFloat(tempSt.state) : climate?.attributes?.current_temperature;
    const humidSt = data.sensors.humid && this._hass.states?.[data.sensors.humid.entity_id];
    const humid = humidSt && humidSt.state !== "unavailable" ? Math.round(parseFloat(humidSt.state)) : null;
    return [temp != null ? `${temp.toFixed(1)}°` : null, humid != null ? `${humid}%` : null].filter(Boolean).join(" · ");
  }

  _buildHero(area, data) {
    this._refs.areas.set(area.area_id, {
      lights: new Map(), switches: new Map(), covers: new Map(),
      climates: new Map(), automations: new Map(), inputSelects: new Map(), sensors: new Map(),
    });

    const hero = document.createElement("div");
    hero.className = "atrium-panel-hero";

    const photo = document.createElement("span");
    photo.className = "atrium-panel-hero-photo" + (area.picture ? " has-img" : "");
    if (area.picture) photo.style.backgroundImage = `url("${area.picture}")`;
    else photo.innerHTML = haIcon(iconForArea(area), 26);

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
