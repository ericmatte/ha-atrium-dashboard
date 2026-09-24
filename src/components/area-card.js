// `set hass()` fires on every state change. `_signature()` only triggers a
// `_build()` when the per-floor entity set actually shifts; otherwise the
// per-ref identity-gated updaters in `area-card-updaters.js` handle it.

import { closePopoverFor } from "../lib/popover.js";
import { sameRegistries, areaIdForEntity, entityDisplayName } from "../lib/hass-utils.js";
import { fireMoreInfo } from "../lib/dom-utils.js";
import { callService, toggleLights } from "../lib/ha-actions.js";
import { STYLE, matchesAny, fmtCoverPct } from "./area-card-shared.js";
import * as buildersMod from "./area-card-builders.js";
import * as updatersMod from "./area-card-updaters.js";
import { subscribeLabelsLoaded } from "../lib/label-registry.js";
import { groupDeviceSensors } from "../lib/device-sensors.js";

class AtriumAreaCard extends HTMLElement {
  constructor() {
    super();
    this._dragState = new Map();
    this._lastSig = "";
    this._floorId = null;
    // Track popovers we opened so disconnectedCallback can close any that
    // survived the card being torn down.
    this._openAnchors = new Set();
  }

  setConfig(config) {
    if (config.floor === undefined) throw new Error("floor is required");
    this._floorId = config.floor === null ? null : config.floor;
    // Intent tabs (Climate, Routines, …) pass a section profile so the card
    // renders only the matching categories. Absent → full room view (Home).
    this._sections =
      Array.isArray(config.sections) && config.sections.length
        ? new Set(config.sections)
        : null;
    // Inverse of `sections`: drop specific categories from the otherwise-full
    // view. Home uses it to hide climate + automations/scripts (each has its
    // own dedicated tab).
    this._exclude =
      Array.isArray(config.exclude) && config.exclude.length
        ? new Set(config.exclude)
        : null;
  }

  connectedCallback() {
    this.style.display = "block";
    this.style.padding = "0 16px 32px";
    if (!this._resizeObserver) {
      this._resizeObserver = new ResizeObserver(() => this._onResize());
      this._resizeObserver.observe(this);
    }
    // hass.labels (the label registry) can arrive after this card already
    // rendered its automations — labelDescriptor falls back to fetching it
    // itself, so re-render once that fetch lands to pick the chips up.
    this._unsubLabels = subscribeLabelsLoaded(() => this._update());
  }

  disconnectedCallback() {
    for (const a of this._openAnchors) closePopoverFor(a);
    this._openAnchors.clear();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    if (this._resizeRaf) {
      cancelAnimationFrame(this._resizeRaf);
      this._resizeRaf = 0;
    }
    this._unsubLabels?.();
    this._unsubLabels = null;
  }

  _areaFloorId(area) {
    return area?.floor_id ?? null;
  }

  set hass(hass) {
    this._hass = hass;
    // Fast path: registries unchanged → states-only tick → incremental
    // update. `_floorId` is threaded through as the extra cache key so a
    // setConfig with a new floor falls through to the rebuild branch.
    if (sameRegistries(this, "_reg", hass, this._floorId) && this._lastSig) {
      this._update();
      return;
    }
    const sig = this._signature();
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this._build();
    } else {
      this._update();
    }
  }

  // Only invoked when a registry reference shifted, to tell apart "entity
  // set on this floor changed" from "entity we don't care about was added
  // elsewhere".
  _signature() {
    const hass = this._hass;
    if (!hass?.areas || !hass?.entities) return "boot";
    const parts = [this._floorId];
    for (const a of Object.values(hass.areas)) {
      if (this._areaFloorId(a) !== this._floorId) continue;
      parts.push(`A:${a.area_id}:${a.picture || ""}`);
    }
    for (const e of Object.values(hass.entities)) {
      const areaId = areaIdForEntity(hass, e);
      if (!areaId) continue;
      const area = hass.areas[areaId];
      if (!area || this._areaFloorId(area) !== this._floorId) continue;
      parts.push(e.entity_id);
    }
    return parts.join("|");
  }

  _areasOnFloor() {
    return Object.values(this._hass.areas)
      .filter((a) => this._areaFloorId(a) === this._floorId);
  }

  _entitiesForArea(area) {
    const hass = this._hass;
    return Object.values(hass.entities)
      .filter((e) => {
        if (e.hidden) return false;
        return areaIdForEntity(hass, e) === area.area_id;
      });
  }

  _hiddenRoutinesForArea(area) {
    const hass = this._hass;
    return Object.values(hass.entities)
      .filter((e) => {
        if (!e.hidden) return false;
        const domain = e.entity_id.split(".")[0];
        if (domain !== "automation" && domain !== "script") return false;
        return areaIdForEntity(hass, e) === area.area_id;
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }

  _emptyData() {
    return {
      lights: [],
      switches: [],
      covers: [],
      doors: [],
      climates: [],
      vacuums: [],
      scenes: [],
      buttons: [],
      inputSelects: [],
      sensors: { motion: [], leak: [], soil: [], propane: [], temp: null, humid: null, extras: [], other: [] },
      automations: [],
      scripts: [],
      deviceSensors: new Map(),
    };
  }

  // Project classified data down to the active section profile. Categories
  // left out are emptied so every downstream consumer (room header chips,
  // quick buttons, body sections, `_areaIsEmpty`) hides them for free.
  _filterData(data) {
    if (this._exclude) return this._excludeData(data);
    if (!this._sections) return data;
    const want = this._sections;
    const out = this._emptyData();
    if (want.has("lights")) {
      out.lights = data.lights;
      out.switches = data.switches;
      out.deviceSensors = data.deviceSensors;
    }
    if (want.has("covers")) out.covers = data.covers;
    if (want.has("climate")) {
      out.climates = data.climates;
      out.sensors.temp = data.sensors.temp;
      out.sensors.humid = data.sensors.humid;
    }
    if (want.has("vacuum")) out.vacuums = data.vacuums;
    if (want.has("inputs")) out.inputSelects = data.inputSelects;
    if (want.has("sensors")) {
      out.sensors.extras = data.sensors.extras;
      out.sensors.other = data.sensors.other;
      out.sensors.soil = data.sensors.soil;
      out.sensors.propane = data.sensors.propane;
    }
    if (want.has("motion")) out.sensors.motion = data.sensors.motion;
    if (want.has("scenes")) out.scenes = data.scenes;
    if (want.has("buttons")) out.buttons = data.buttons;
    if (want.has("routines")) {
      out.automations = data.automations;
      out.scripts = data.scripts;
    }
    if (want.has("doors")) out.doors = data.doors;
    if (want.has("leak")) out.sensors.leak = data.sensors.leak;
    return out;
  }

  // Full view minus a few categories. Keys map 1:1 to top-level data arrays;
  // temp/humidity chips survive even when "climates" is dropped.
  _excludeData(data) {
    const out = { ...data, sensors: { ...data.sensors } };
    for (const key of this._exclude) {
      if (key === "climates") out.climates = [];
      else if (key === "automations") out.automations = [];
      else if (key === "scripts") out.scripts = [];
      else if (key === "scenes") out.scenes = [];
      else if (key === "buttons") out.buttons = [];
      else if (key === "lights") { out.lights = []; out.switches = []; }
      else if (key === "covers") out.covers = [];
      else if (key === "vacuums") out.vacuums = [];
      else if (key === "inputs") out.inputSelects = [];
    }
    return out;
  }

  _classify(area, entities) {
    const hass = this._hass;
    const out = this._emptyData();

    for (const e of entities) {
      const domain = e.entity_id.split(".")[0];
      const st = hass.states?.[e.entity_id];
      const dc = st?.attributes?.device_class;
      if (domain === "light") out.lights.push(e);
      // Config/diagnostic switches (device knobs like "LED", "crossfade") would
      // clutter the room body — only surface primary controls.
      else if (domain === "switch") { if (!e.entity_category) out.switches.push(e); }
      else if (domain === "cover") out.covers.push(e);
      else if (domain === "climate") out.climates.push(e);
      else if (domain === "vacuum") out.vacuums.push(e);
      else if (domain === "scene") out.scenes.push(e);
      // Devices expose config/diagnostic buttons ("Restart", "Identify") that
      // would drown the room body — only surface primary ones, like switches.
      else if (domain === "button") { if (!e.entity_category) out.buttons.push(e); }
      else if (domain === "input_select") out.inputSelects.push(e);
      else if (domain === "automation") out.automations.push(e);
      else if (domain === "script") out.scripts.push(e);
      else if (domain === "binary_sensor") {
        if (dc === "motion" || dc === "occupancy" || dc === "presence") out.sensors.motion.push(e);
        else if (dc === "moisture") out.sensors.leak.push(e);
        else if (dc === "door" || dc === "garage_door" || dc === "window" || dc === "opening") out.doors.push(e);
        else out.sensors.other.push(e);
      } else if (domain === "sensor") {
        const isSoil =
          matchesAny(e.entity_id, ["soil", "plant"]) &&
          dc !== "battery" &&
          !matchesAny(e.entity_id, ["battery"]) &&
          (dc === "moisture" || st?.attributes?.unit_of_measurement === "%");
        const isPropane = matchesAny(e.entity_id, ["propane", "fuel_tank", "gas_tank"]);
        const isTempWinner =
          dc === "temperature" &&
          (e.entity_id === area.temperature_entity_id || !out.sensors.temp);
        const isHumidEligible = dc === "humidity" && !matchesAny(e.entity_id, ["soil"]);
        const isHumidWinner =
          isHumidEligible &&
          (e.entity_id === area.humidity_entity_id || !out.sensors.humid);

        if (isSoil) out.sensors.soil.push(e);
        else if (isPropane) out.sensors.propane.push(e);
        else if (isTempWinner) out.sensors.temp = e;
        else if (isHumidWinner) out.sensors.humid = e;
        else {
          // Any other sensor that isn't already represented in the header
          // chips lands here so the body can graph it. Battery/text/timestamp
          // sensors don't make sense as a line — gate them out.
          const dcExclude = new Set(["battery", "enum", "date", "timestamp", "duration"]);
          const unit = st?.attributes?.unit_of_measurement;
          const numericNow = Number.isFinite(parseFloat(st?.state));
          const isPlottable = !dcExclude.has(dc || "") && (unit != null || numericNow);
          if (isPlottable) out.sensors.extras.push(e);
        }
      }
    }

    const grouped = groupDeviceSensors({
      lights: out.lights,
      switches: out.switches,
      extras: out.sensors.extras,
      other: out.sensors.other,
    });
    out.sensors.extras = grouped.extras;
    out.sensors.other = grouped.other;
    out.deviceSensors = grouped.deviceSensors;

    return out;
  }

  _call(domain, service, data) {
    return callService(this._hass, domain, service, data);
  }

  _moreInfo(entityId) {
    fireMoreInfo(this, entityId);
  }

  _build() {
    if (!this._hass) return;
    this.innerHTML = "";
    // Styles live as a child of this element so they sit in the same
    // shadow scope as our descendants — document.head doesn't reach
    // inside hui-card's shadow root.
    const styleEl = document.createElement("style");
    styleEl.textContent = STYLE;
    this.appendChild(styleEl);

    const root = document.createElement("div");
    root.className = "atrium-root";
    this._refs = { areas: new Map() };

    const areas = this._areasOnFloor();
    const cards = [];
    for (const area of areas) {
      const entities = this._entitiesForArea(area);
      const data = this._filterData(this._classify(area, entities));
      if (this._sections?.has("routines")) {
        data.hiddenRoutines = this._hiddenRoutinesForArea(area);
      }
      if (this._areaIsEmpty(data)) continue;
      cards.push(this._buildRoomCard(area, data));
    }
    this._roomCards = cards;
    const body = document.createElement("div");
    body.className = "atrium-floor-body";
    body.appendChild(root);
    // Append the (empty) root first so getComputedStyle can resolve the
    // --atrium-cols breakpoint variable before we distribute.
    this.appendChild(body);
    this._bodyEl = body;
    this._root = root;
    this._layoutMasonry();
    this._update();
  }

  // Distribute the room cards into N flex columns (N = --atrium-cols), greedily
  // placing each card into the currently shortest column. This packs
  // variable-height cards without the row-aligned gaps a CSS grid leaves.
  _layoutMasonry() {
    const root = this._root;
    if (!root) return;
    const colCount = this._colsFromCss(root);
    this._colCount = colCount;
    root.replaceChildren();
    this._cols = Array.from({ length: colCount }, () => {
      const col = document.createElement("div");
      col.className = "atrium-col";
      root.appendChild(col);
      return col;
    });
    for (const card of this._roomCards || []) {
      let shortest = this._cols[0];
      for (const col of this._cols) {
        if (col.offsetHeight < shortest.offsetHeight) shortest = col;
      }
      shortest.appendChild(card);
    }
  }

  _colsFromCss(root) {
    const raw = getComputedStyle(root).getPropertyValue("--atrium-cols");
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  // Re-distribute only when the breakpoint (column count) changes.
  _onResize() {
    if (this._resizeRaf) return;
    this._resizeRaf = requestAnimationFrame(() => {
      this._resizeRaf = 0;
      if (!this._root) return;
      if (this._colsFromCss(this._root) !== this._colCount) this._layoutMasonry();
    });
  }

  _areaIsEmpty(d) {
    return (
      d.lights.length === 0 &&
      d.switches.length === 0 &&
      d.covers.length === 0 &&
      d.doors.length === 0 &&
      d.climates.length === 0 &&
      d.vacuums.length === 0 &&
      d.scenes.length === 0 &&
      d.buttons.length === 0 &&
      d.inputSelects.length === 0 &&
      d.automations.length === 0 &&
      d.scripts.length === 0 &&
      !d.sensors.temp &&
      !d.sensors.humid &&
      d.sensors.motion.length === 0 &&
      d.sensors.leak.length === 0 &&
      d.sensors.soil.length === 0 &&
      d.sensors.propane.length === 0 &&
      d.sensors.extras.length === 0 &&
      d.sensors.other.length === 0
    );
  }

  // direction is -1 or +1: the size of the move belongs to the device, not to
  // us. A 1°C heat pump silently ignores the 0.5° setpoints a thermostat takes.
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

  _entityName(entity) {
    return entityDisplayName(this._hass, entity);
  }

  _update() {
    if (!this._refs) return;
    for (const [, ar] of this._refs.areas) {
      this._updateChips(ar);
      this._updateQuickButtons(ar);

      for (const [entId, ref] of ar.lights) this._updateLightRef(ref, entId);
      if (ar.switches) for (const [entId, ref] of ar.switches) this._updateSwitchRef(ref, entId);
      for (const [entId, ref] of ar.climates) this._updateClimateRef(ref, entId);
      if (ar.inputSelects) for (const [entId, ref] of ar.inputSelects) this._updateInputSelectRef(ref, entId);
      for (const [entId, ref] of ar.automations) this._updateAutomationRef(ref, entId);
      if (ar.sensors) for (const ref of ar.sensors.values()) this._updateSensorRef(ref, ref.entityId);
    }
  }

  static getConfigElement() { return null; }
  static getStubConfig() { return { floor: "" }; }
  getCardSize() { return 1; }
}

Object.assign(AtriumAreaCard.prototype, buildersMod, updatersMod);

customElements.define("atrium-area-card", AtriumAreaCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "atrium-area-card",
  name: "Atrium Area Card",
  description: "Renders every area on a floor as an accordion (swipe-to-dim tiles, chips, scenes, automations drawer)",
});
