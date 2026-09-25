import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyAreaData,
  entitiesForArea,
  classifyAreaEntities,
  areaIsEmpty,
  areaHasAlert,
  areaAlertIcon,
  areaAlert,
  areaPresence,
  areaActivity,
  areaStatusDot,
  areaMetaLine,
  lightsSummary,
  levelTone,
  routineRows,
  sensorTone,
  areaPanelSignature,
} from "./area-data.js";

test("entitiesForArea: drops hidden entities and ones outside the area — but keeps hidden routines", () => {
  const hass = {
    entities: {
      "light.a": { entity_id: "light.a", area_id: "kitchen", hidden: false },
      "light.b": { entity_id: "light.b", area_id: "kitchen", hidden: true },
      "light.c": { entity_id: "light.c", area_id: "hall", hidden: false },
      "automation.secret": { entity_id: "automation.secret", area_id: "kitchen", hidden: true },
      "script.secret": { entity_id: "script.secret", area_id: "kitchen", hidden: true },
    },
    devices: {},
  };
  const out = entitiesForArea(hass, { area_id: "kitchen" });
  assert.deepEqual(out.map((e) => e.entity_id), ["light.a", "automation.secret", "script.secret"]);
});

test("classifyAreaEntities: a binary_sensor with no motion/leak/door device_class and no shared device lands in sensors.other", () => {
  const hass = { states: { "binary_sensor.mystery": { state: "on", attributes: {} } } };
  const area = { area_id: "kitchen" };
  const data = classifyAreaEntities(hass, area, [{ entity_id: "binary_sensor.mystery" }]);
  assert.equal(data.sensors.other.length, 1);
  assert.equal(data.sensors.other[0].entity_id, "binary_sensor.mystery");
});

test("classifyAreaEntities: a primary button entity lands in buttons, a config/diagnostic one is dropped", () => {
  const hass = { states: {} };
  const area = { area_id: "living_room" };
  const data = classifyAreaEntities(hass, area, [
    { entity_id: "button.fan_power" },
    { entity_id: "button.speaker_restart", entity_category: "config" },
  ]);
  assert.deepEqual(data.buttons.map((b) => b.entity_id), ["button.fan_power"]);
});

test("classifyAreaEntities: a config/diagnostic switch is dropped, a primary one is kept", () => {
  const hass = { states: {} };
  const area = { area_id: "living_room" };
  const data = classifyAreaEntities(hass, area, [
    { entity_id: "switch.fan" },
    { entity_id: "switch.led_config", entity_category: "config" },
  ]);
  assert.deepEqual(data.switches.map((s) => s.entity_id), ["switch.fan"]);
});

test("areaIsEmpty: a room whose only entity is a non-device-linked 'other' binary_sensor is not empty (regression)", () => {
  const data = emptyAreaData();
  data.sensors.other = [{ entity_id: "binary_sensor.mystery" }];
  assert.equal(areaIsEmpty(data), false);
});

test("areaHasAlert: an active leak sensor is an alert", () => {
  const hass = { states: { "binary_sensor.leak": { state: "on" } } };
  const data = emptyAreaData();
  data.sensors.leak = [{ entity_id: "binary_sensor.leak" }];
  assert.equal(areaHasAlert(hass, data), true);
});

test("areaHasAlert: a 'problem' binary_sensor that's off is not an alert", () => {
  const hass = { states: { "binary_sensor.heater": { state: "off", attributes: { device_class: "problem" } } } };
  const data = emptyAreaData();
  data.sensors.other = [{ entity_id: "binary_sensor.heater" }];
  assert.equal(areaHasAlert(hass, data), false);
});

test("areaHasAlert: a 'problem' binary_sensor that's on is an alert", () => {
  const hass = { states: { "binary_sensor.heater": { state: "on", attributes: { device_class: "problem" } } } };
  const data = emptyAreaData();
  data.sensors.other = [{ entity_id: "binary_sensor.heater" }];
  assert.equal(areaHasAlert(hass, data), true);
});

test("areaHasAlert: an unavailable device is not a tile alert", () => {
  const hass = { states: { "light.a": { state: "unavailable" } } };
  const data = emptyAreaData();
  data.lights = [{ entity_id: "light.a" }];
  assert.equal(areaHasAlert(hass, data), false);
});

test("areaIsEmpty: a room with nothing classified stays empty", () => {
  assert.equal(areaIsEmpty(emptyAreaData()), true);
});

test("areaIsEmpty: a room whose only entity is a button is not empty", () => {
  const data = emptyAreaData();
  data.buttons = [{ entity_id: "button.fan_power" }];
  assert.equal(areaIsEmpty(data), false);
});

test("areaAlertIcon: a leak outranks an open door, and an open door alone still flags the area", () => {
  const data = emptyAreaData();
  data.doors.push({ entity_id: "binary_sensor.front_door" });
  data.sensors.leak.push({ entity_id: "binary_sensor.sink_leak" });
  const hass = {
    states: {
      "binary_sensor.front_door": { state: "on", attributes: { device_class: "door" } },
      "binary_sensor.sink_leak": { state: "off", attributes: { device_class: "moisture" } },
    },
  };
  assert.equal(areaAlertIcon(hass, data), "mdi:door-open");
  hass.states["binary_sensor.sink_leak"].state = "on";
  assert.equal(areaAlertIcon(hass, data), "mdi:water-alert");
});

test("areaAlertIcon: nothing wrong → null", () => {
  assert.equal(areaAlertIcon({ states: {} }, emptyAreaData()), null);
});

test("sensorTone: alarms red, open doors and low batteries amber, motion blue, idle nothing", () => {
  const st = (entity_id, state, device_class) => ({ entity_id, state, attributes: { device_class } });
  assert.equal(sensorTone(st("binary_sensor.leak", "on", "moisture")), "alert");
  assert.equal(sensorTone(st("binary_sensor.leak", "off", "moisture")), null);
  assert.equal(sensorTone(st("binary_sensor.door", "on", "door")), "warn");
  assert.equal(sensorTone(st("binary_sensor.motion", "on", "motion")), "info");
  assert.equal(sensorTone(st("sensor.remote_battery", "12", "battery")), "warn");
  assert.equal(sensorTone(st("sensor.remote_battery", "80", "battery")), null);
  assert.equal(sensorTone(st("sensor.lux", "310", "illuminance")), null);
  assert.equal(sensorTone(undefined), null);
});

test("areaPanelSignature: stable across state changes, changes when an entity is added", () => {
  const area = { area_id: "kitchen", name: "Kitchen", picture: null };
  const data = emptyAreaData();
  data.lights.push({ entity_id: "light.main" });
  const before = areaPanelSignature(area, data);
  assert.equal(areaPanelSignature(area, data), before);
  data.switches.push({ entity_id: "switch.coffee" });
  assert.notEqual(areaPanelSignature(area, data), before);
});

test("areaAlert: names what's wrong for the text under the tile", () => {
  const data = emptyAreaData();
  data.doors.push({ entity_id: "binary_sensor.patio" });
  const hass = { states: { "binary_sensor.patio": { state: "on", attributes: { device_class: "window" } } } };
  assert.deepEqual(areaAlert(hass, data), { icon: "mdi:door-open", label: "Window open", tone: "warn", entityId: "binary_sensor.patio" });
  hass.states["binary_sensor.patio"].attributes.device_class = "door";
  assert.equal(areaAlert(hass, data).label, "Door open");
});

test("areaMetaLine: temperature · humidity normally; an alert takes humidity's place", () => {
  assert.equal(areaMetaLine({ temp: 23.1, humid: 46 }), "23.1° · 46%");
  assert.equal(areaMetaLine({ temp: 23.1, humid: 46, alert: "Leak!" }), "23.1° · Leak!");
  assert.equal(areaMetaLine({ alert: "Door open" }), "Door open");
  assert.equal(areaMetaLine({ humid: 68 }), "68%");
  assert.equal(areaMetaLine({}), "");
});

test("areaAlert: a leak is red (alert), an open door orange (warn)", () => {
  const data = emptyAreaData();
  data.sensors.leak.push({ entity_id: "binary_sensor.leak" });
  const hass = { states: { "binary_sensor.leak": { state: "on", attributes: { device_class: "moisture" } } } };
  assert.equal(areaAlert(hass, data).tone, "alert");
});

test("areaPresence: only motion detected right now counts", () => {
  const data = emptyAreaData();
  data.sensors.motion.push({ entity_id: "binary_sensor.a" }, { entity_id: "binary_sensor.b" });
  const hass = { states: { "binary_sensor.a": { state: "off" }, "binary_sensor.b": { state: "on" } } };
  assert.deepEqual(areaPresence(hass, data), { icon: "mdi:walk", entityId: "binary_sensor.b" });
  hass.states["binary_sensor.b"].state = "off";
  assert.equal(areaPresence(hass, data), null);
});

test("areaActivity: media playing beats a vacuum cleaning, which beats climate heating", () => {
  const data = emptyAreaData();
  data.mediaPlayers.push({ entity_id: "media_player.tv" });
  data.vacuums.push({ entity_id: "vacuum.roby" });
  data.climates.push({ entity_id: "climate.hp" });
  const hass = {
    states: {
      "media_player.tv": { state: "playing", attributes: {} },
      "vacuum.roby": { state: "cleaning", attributes: {} },
      "climate.hp": { state: "heat", attributes: { hvac_action: "heating" } },
    },
  };
  assert.deepEqual(areaActivity(hass, data), { kind: "media", playing: true, icon: "mdi:pause", entityId: "media_player.tv", action: ["media_player", "media_play_pause"] });
  hass.states["media_player.tv"].state = "idle";
  assert.equal(areaActivity(hass, data).kind, "vacuum");
  hass.states["vacuum.roby"].state = "docked";
  assert.equal(areaActivity(hass, data).kind, "heating");
  hass.states["climate.hp"].attributes.hvac_action = "cooling";
  assert.equal(areaActivity(hass, data).icon, "mdi:snowflake");
  hass.states["climate.hp"].attributes.hvac_action = "idle";
  assert.equal(areaActivity(hass, data).icon, "mdi:play");
  hass.states["media_player.tv"].state = "off";
  assert.equal(areaActivity(hass, data), null);
});

test("areaActivity: a paused or idle player shows play (after live activity); an off one shows nothing", () => {
  const data = emptyAreaData();
  data.mediaPlayers.push({ entity_id: "media_player.tv" });
  data.climates.push({ entity_id: "climate.hp" });
  const hass = { states: { "media_player.tv": { state: "idle", attributes: {} }, "climate.hp": { state: "heat", attributes: { hvac_action: "heating" } } } };
  assert.equal(areaActivity(hass, data).kind, "heating");
  hass.states["climate.hp"].attributes.hvac_action = "idle";
  assert.deepEqual(areaActivity(hass, data), { kind: "media", playing: false, icon: "mdi:play", entityId: "media_player.tv", action: ["media_player", "media_play_pause"] });
  hass.states["media_player.tv"].state = "paused";
  assert.equal(areaActivity(hass, data).icon, "mdi:play");
  hass.states["media_player.tv"].state = "off";
  assert.equal(areaActivity(hass, data), null);
});



test("lightsSummary: counts lights on out of the total", () => {
  const hass = { states: { "light.a": { state: "on" }, "light.b": { state: "off" }, "light.c": { state: "unavailable" } } };
  assert.deepEqual(lightsSummary(hass, ["light.a", "light.b", "light.c"]), { on: 1, total: 3 });
  assert.deepEqual(lightsSummary(hass, []), { on: 0, total: 0 });
});

test("areaStatusDot: motion beats an alert; without motion the alert comes back", () => {
  const presence = { icon: "mdi:walk", entityId: "binary_sensor.motion" };
  const leak = { icon: "mdi:water-alert", label: "Leak!", tone: "alert", entityId: "binary_sensor.leak" };
  const door = { icon: "mdi:door-open", label: "Door open", tone: "warn", entityId: "binary_sensor.door" };
  assert.equal(areaStatusDot(presence, leak).kind, "presence");
  assert.equal(areaStatusDot(presence, leak).entityId, "binary_sensor.motion");
  assert.equal(areaStatusDot(null, leak).kind, "alert");
  assert.equal(areaStatusDot(null, door).kind, "warn");
  assert.equal(areaStatusDot(null, null), null);
});

test("classifyAreaEntities: a switched-off automation goes to disabledAutomations", () => {
  const hass = {
    states: { "automation.on": { state: "on", attributes: {} }, "automation.off": { state: "off", attributes: {} } },
    entities: {}, devices: {},
  };
  const out = classifyAreaEntities(hass, { area_id: "k" }, [{ entity_id: "automation.on" }, { entity_id: "automation.off" }]);
  assert.deepEqual(out.automations.map((e) => e.entity_id), ["automation.on"]);
  assert.deepEqual(out.disabledAutomations.map((e) => e.entity_id), ["automation.off"]);
});

test("areaPanelSignature: switching an automation on/off doesn't change it (Routines update in place)", () => {
  const area = { area_id: "k", name: "K" };
  const a = emptyAreaData();
  a.automations.push({ entity_id: "automation.x" });
  const b = emptyAreaData();
  b.disabledAutomations.push({ entity_id: "automation.x" });
  assert.equal(areaPanelSignature(area, a), areaPanelSignature(area, b));
  b.automations.push({ entity_id: "automation.y" });
  assert.notEqual(areaPanelSignature(area, a), areaPanelSignature(area, b));
});


test("classifyAreaEntities: a soil probe's moisture is the soil level; its air humidity is just a reading", () => {
  const hass = {
    states: {
      "sensor.soil_moisture_soil_moisture": { state: "40", attributes: { device_class: "moisture", unit_of_measurement: "%" } },
      "sensor.soil_moisture_humidity": { state: "83", attributes: { device_class: "humidity", unit_of_measurement: "%" } },
      "sensor.soil_moisture_battery": { state: "100", attributes: { device_class: "battery", unit_of_measurement: "%" } },
    },
    entities: {}, devices: {},
  };
  const ids = Object.keys(hass.states).map((entity_id) => ({ entity_id }));
  const out = classifyAreaEntities(hass, { area_id: "office" }, ids);
  assert.deepEqual(out.sensors.soil.map((e) => e.entity_id), ["sensor.soil_moisture_soil_moisture"]);
  assert.deepEqual(out.sensors.extras.map((e) => e.entity_id), ["sensor.soil_moisture_humidity"]);
});

test("levelTone: red when nearly empty, amber when low, green otherwise", () => {
  assert.equal(levelTone(12), "alert");
  assert.equal(levelTone(31), "warn");
  assert.equal(levelTone(64), "good");
});

test("classifyAreaEntities: input_boolean helpers are collected for the panel", () => {
  const hass = { states: { "input_boolean.guest": { state: "on", attributes: {} } }, entities: {}, devices: {} };
  const out = classifyAreaEntities(hass, { area_id: "o" }, [{ entity_id: "input_boolean.guest" }]);
  assert.deepEqual(out.inputBooleans.map((e) => e.entity_id), ["input_boolean.guest"]);
  assert.equal(areaIsEmpty(out), false);
});

test("routineRows: scripts before automations; switched-off automations only when that badge is open", () => {
  const data = emptyAreaData();
  const e = (id) => ({ entity_id: id });
  data.scripts = [e("script.run")];
  data.automations = [e("automation.on")];
  data.disabledAutomations = [e("automation.off")];
  const ids = (opts) => routineRows(data, opts).map((r) => r.entity.entity_id + (r.disabled ? "(d)" : ""));
  assert.deepEqual(ids(), ["script.run", "automation.on"]);
  assert.deepEqual(ids({ showDisabled: true }), ["script.run", "automation.on", "automation.off(d)"]);
});

