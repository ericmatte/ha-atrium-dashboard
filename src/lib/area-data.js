// Pure hass → per-area data shaping, shared by the rooms view (one area at a
// time, in its details panel) and its tests. No DOM, no `this` binding.

import { areaIdForEntity } from "./hass-utils.js";
import { groupDeviceSensors } from "./device-sensors.js";

export function matchesAny(haystack, needles) {
  const lower = (haystack || "").toLowerCase();
  return needles.some((n) => lower.includes(n));
}

export function emptyAreaData() {
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

export function entitiesForArea(hass, area) {
  return Object.values(hass.entities).filter((e) => {
    if (e.hidden) return false;
    return areaIdForEntity(hass, e) === area.area_id;
  });
}

// Automations/scripts hidden from view but still worth surfacing now that
// there's no separate Routines tab to relegate them to — shown as a
// collapsed "N hidden" affordance in the automations section instead of
// mixed in with the visible ones.
export function hiddenRoutinesForArea(hass, area) {
  return Object.values(hass.entities)
    .filter((e) => {
      if (!e.hidden) return false;
      const domain = e.entity_id.split(".")[0];
      if (domain !== "automation" && domain !== "script") return false;
      return areaIdForEntity(hass, e) === area.area_id;
    })
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export function classifyAreaEntities(hass, area, entities) {
  const out = emptyAreaData();

  for (const e of entities) {
    const domain = e.entity_id.split(".")[0];
    const st = hass.states?.[e.entity_id];
    const dc = st?.attributes?.device_class;
    if (domain === "light") out.lights.push(e);
    // Config/diagnostic switches (device knobs like "LED", "crossfade") would
    // clutter the room panel — only surface primary controls.
    else if (domain === "switch") { if (!e.entity_category) out.switches.push(e); }
    else if (domain === "cover") out.covers.push(e);
    else if (domain === "climate") out.climates.push(e);
    else if (domain === "vacuum") out.vacuums.push(e);
    else if (domain === "scene") out.scenes.push(e);
    // Devices expose config/diagnostic buttons ("Restart", "Identify") that
    // would drown the room panel — only surface primary ones, like switches.
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
        // Any other sensor that isn't already represented as a badge lands
        // here so the panel can list it. Battery/text/timestamp sensors
        // don't make sense as a reading — gate them out.
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

// Drives the orb's red alert dot and the panel hero's alert/warn badges:
// any active leak or "problem" binary_sensor, or an unavailable entity in a
// domain where that's actually meaningful (mirrors the header's own
// PROBLEM_UNAVAILABLE_DOMAINS notion of "worth flagging").
const ALERT_UNAVAILABLE_DOMAINS = new Set(["light", "switch", "cover", "climate", "vacuum"]);
export function areaHasAlert(hass, data) {
  if (data.sensors.leak.some((e) => hass.states?.[e.entity_id]?.state === "on")) return true;
  const problemLike = [...data.sensors.other, ...data.doors];
  if (problemLike.some((e) => {
    const st = hass.states?.[e.entity_id];
    return st?.attributes?.device_class === "problem" && st.state === "on";
  })) return true;
  const controllable = [...data.lights, ...data.switches, ...data.covers, ...data.climates, ...data.vacuums];
  return controllable.some((e) => ALERT_UNAVAILABLE_DOMAINS.has(e.entity_id.split(".")[0]) && hass.states?.[e.entity_id]?.state === "unavailable");
}

export function areaIsEmpty(d) {
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
