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
    mediaPlayers: [],
    scenes: [],
    buttons: [],
    inputSelects: [],
    inputBooleans: [],
    sensors: { motion: [], leak: [], soil: [], propane: [], temp: null, humid: null, extras: [], other: [] },
    automations: [],
    disabledAutomations: [],
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
    else if (domain === "media_player") out.mediaPlayers.push(e);
    else if (domain === "scene") out.scenes.push(e);
    // Devices expose config/diagnostic buttons ("Restart", "Identify") that
    // would drown the room panel — only surface primary ones, like switches.
    else if (domain === "button") { if (!e.entity_category) out.buttons.push(e); }
    else if (domain === "input_select") out.inputSelects.push(e);
    else if (domain === "input_boolean") out.inputBooleans.push(e);
    // A switched-off automation leaves the routines list for its "N disabled"
    // drawer until it's turned back on.
    else if (domain === "automation") (st?.state === "off" ? out.disabledAutomations : out.automations).push(e);
    else if (domain === "script") out.scripts.push(e);
    else if (domain === "binary_sensor") {
      if (dc === "motion" || dc === "occupancy" || dc === "presence") out.sensors.motion.push(e);
      else if (dc === "moisture") out.sensors.leak.push(e);
      else if (dc === "door" || dc === "garage_door" || dc === "window" || dc === "opening") out.doors.push(e);
      else out.sensors.other.push(e);
    } else if (domain === "sensor") {
      // A plant/soil probe also reports air humidity, temperature and battery;
      // only its moisture reading (or an untyped %) is the soil level.
      const isSoil =
        matchesAny(e.entity_id, ["soil", "plant"]) &&
        !matchesAny(e.entity_id, ["battery"]) &&
        (dc === "moisture" || (!dc && st?.attributes?.unit_of_measurement === "%"));
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

// Drives the orb's alert dot and the alert text under the tile: an active
// leak or "problem" binary_sensor, or an open door. (Unavailable devices are
// left to the header's problem pill — too noisy on every tile.)
// Returns the most serious one as { icon, label, tone, entityId }, or null —
// tone "alert" (red) for things that are wrong, "warn" (orange) for an
// opening; entityId is what tapping the dot opens.
const OPEN_LABEL = { window: "Window open", garage_door: "Garage open" };
export function areaAlert(hass, data) {
  const st = (e) => hass.states?.[e.entity_id];
  const isOn = (e) => st(e)?.state === "on";
  const found = (e, alert) => (e ? { ...alert, entityId: e.entity_id } : null);
  const leak = data.sensors.leak.find(isOn);
  if (leak) return found(leak, { icon: "mdi:water-alert", label: "Leak!", tone: "alert" });
  const problem = [...data.sensors.other, ...data.doors].find((e) => isOn(e) && st(e).attributes?.device_class === "problem");
  if (problem) return found(problem, { icon: "mdi:alert", label: "Problem", tone: "alert" });
  const open = data.doors.find(isOn);
  if (open) return found(open, { icon: "mdi:door-open", label: OPEN_LABEL[st(open).attributes?.device_class] || "Door open", tone: "warn" });
  return null;
}

// Someone is in the room right now: the first motion/occupancy/presence
// sensor that's on, or null.
export function areaPresence(hass, data) {
  const e = data.sensors.motion.find((m) => hass.states?.[m.entity_id]?.state === "on");
  return e ? { icon: "mdi:walk", entityId: e.entity_id } : null;
}

// The tile's top-right dot: motion right now wins over an alert (someone is
// there, that's the live news); when motion clears, the alert shows again.
export function areaStatusDot(presence, alert) {
  if (presence) return { kind: "presence", ...presence };
  if (alert) return { kind: alert.tone === "warn" ? "warn" : "alert", ...alert };
  return null;
}

// The one thing actively running in the room, by priority: media playing,
// then a vacuum cleaning, then climate actually heating or cooling (not
// merely switched on). `action` is what tapping it does.
const TV_DEVICE_CLASSES = new Set(["tv", "receiver"]);
export function areaActivity(hass, data) {
  const st = (e) => hass.states?.[e.entity_id];
  const media = data.mediaPlayers.find((e) => st(e)?.state === "playing");
  if (media) {
    const isTv = TV_DEVICE_CLASSES.has(st(media).attributes?.device_class);
    return { kind: "media", icon: isTv ? "mdi:television-play" : "mdi:music", entityId: media.entity_id, action: ["media_player", "media_play_pause"] };
  }
  const vacuum = data.vacuums.find((e) => st(e)?.state === "cleaning");
  if (vacuum) return { kind: "vacuum", icon: "mdi:robot-vacuum", entityId: vacuum.entity_id, action: ["vacuum", "pause"] };
  for (const e of data.climates) {
    const action = st(e)?.attributes?.hvac_action;
    if (action === "heating") return { kind: "heating", icon: "mdi:fire", entityId: e.entity_id, action: null };
    if (action === "cooling") return { kind: "cooling", icon: "mdi:snowflake", entityId: e.entity_id, action: null };
  }
  return null;
}

export function areaAlertIcon(hass, data) {
  return areaAlert(hass, data)?.icon ?? null;
}

// The line under an area's tile. An alert replaces the humidity: it's what
// matters right now, and the line stays one short glance.
export function areaMetaLine({ temp, humid, alert }) {
  return [temp != null ? `${temp.toFixed(1)}°` : null, alert ?? (humid != null ? `${humid}%` : null)].filter(Boolean).join(" · ");
}

// How many of these lights are on, out of how many — unavailable ones count
// toward the total but never as on.
export function lightsSummary(hass, lightIds) {
  return { on: lightIds.filter((id) => hass.states?.[id]?.state === "on").length, total: lightIds.length };
}

// Colors a tank-style level (propane, fuel): red when nearly empty, amber
// when low, green otherwise.
export function levelTone(pct) {
  if (pct <= 20) return "alert";
  if (pct <= 40) return "warn";
  return "good";
}

export function areaHasAlert(hass, data) {
  return areaAlertIcon(hass, data) != null;
}

// Colors a sensor reading in the panel: alarms red, things that need a look
// (open door, low battery) amber, live activity (motion) blue.
const ALERT_DEVICE_CLASSES = new Set(["moisture", "problem", "smoke", "gas", "carbon_monoxide", "safety", "tamper"]);
const WARN_DEVICE_CLASSES = new Set(["door", "garage_door", "window", "opening"]);
const INFO_DEVICE_CLASSES = new Set(["motion", "occupancy", "presence"]);
const LOW_BATTERY_PCT = 20;
export function sensorTone(state) {
  if (!state) return null;
  const dc = state.attributes?.device_class;
  const domain = (state.entity_id || "").split(".")[0];
  if (domain === "binary_sensor") {
    if (state.state !== "on") return null;
    if (ALERT_DEVICE_CLASSES.has(dc)) return "alert";
    if (WARN_DEVICE_CLASSES.has(dc)) return "warn";
    if (INFO_DEVICE_CLASSES.has(dc)) return "info";
    return null;
  }
  if (dc === "battery" && parseFloat(state.state) <= LOW_BATTERY_PCT) return "warn";
  return null;
}

// Every entity the details panel draws for an area, in a stable order. Two
// equal signatures mean the panel's structure is unchanged, so a state
// change only needs its tiles updated in place (keeping their transitions)
// rather than a rebuild.
export function areaPanelSignature(area, data) {
  const ids = [
    ...data.climates, ...data.mediaPlayers, ...data.scenes, ...data.buttons, ...data.lights, ...data.switches,
    ...data.inputSelects, ...data.inputBooleans, ...data.covers, ...data.sensors.extras, ...data.sensors.other,
    ...data.automations, ...data.scripts, "disabled:", ...data.disabledAutomations, "hidden:", ...(data.hiddenRoutines || []),
  ].map((e) => (typeof e === "string" ? e : e.entity_id));
  for (const [target, sensors] of data.deviceSensors) ids.push(`${target}>${sensors.map((s) => s.entity_id).join(",")}`);
  return [area.area_id, area.name, area.picture || "", ...ids].join("|");
}

export function areaIsEmpty(d) {
  return (
    d.lights.length === 0 &&
    d.switches.length === 0 &&
    d.covers.length === 0 &&
    d.doors.length === 0 &&
    d.climates.length === 0 &&
    d.vacuums.length === 0 &&
    d.mediaPlayers.length === 0 &&
    d.scenes.length === 0 &&
    d.buttons.length === 0 &&
    d.inputSelects.length === 0 &&
    d.inputBooleans.length === 0 &&
    d.automations.length === 0 &&
    d.disabledAutomations.length === 0 &&
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
