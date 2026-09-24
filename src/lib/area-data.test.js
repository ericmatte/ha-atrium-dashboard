import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyAreaData,
  entitiesForArea,
  hiddenRoutinesForArea,
  classifyAreaEntities,
  areaIsEmpty,
  areaHasAlert,
} from "./area-data.js";

test("entitiesForArea: drops hidden entities and ones outside the area", () => {
  const hass = {
    entities: {
      "light.a": { entity_id: "light.a", area_id: "kitchen", hidden: false },
      "light.b": { entity_id: "light.b", area_id: "kitchen", hidden: true },
      "light.c": { entity_id: "light.c", area_id: "hall", hidden: false },
    },
    devices: {},
  };
  const out = entitiesForArea(hass, { area_id: "kitchen" });
  assert.deepEqual(out.map((e) => e.entity_id), ["light.a"]);
});

test("hiddenRoutinesForArea: only hidden automation/script entities in the area, sorted by name", () => {
  const hass = {
    entities: {
      "automation.b": { entity_id: "automation.b", area_id: "kitchen", hidden: true, name: "B" },
      "automation.a": { entity_id: "automation.a", area_id: "kitchen", hidden: true, name: "A" },
      "script.hidden": { entity_id: "script.hidden", area_id: "kitchen", hidden: true, name: "Z" },
      "light.hidden": { entity_id: "light.hidden", area_id: "kitchen", hidden: true, name: "L" },
      "automation.visible": { entity_id: "automation.visible", area_id: "kitchen", hidden: false, name: "V" },
    },
    devices: {},
  };
  const out = hiddenRoutinesForArea(hass, { area_id: "kitchen" });
  assert.deepEqual(out.map((e) => e.entity_id), ["automation.a", "automation.b", "script.hidden"]);
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

test("areaHasAlert: an unavailable light is an alert, an unavailable non-controllable sensor is not", () => {
  const hass = { states: { "light.a": { state: "unavailable" }, "sensor.a": { state: "unavailable" } } };
  const data = emptyAreaData();
  data.lights = [{ entity_id: "light.a" }];
  data.sensors.extras = [{ entity_id: "sensor.a" }];
  assert.equal(areaHasAlert(hass, data), true);

  const data2 = emptyAreaData();
  data2.sensors.extras = [{ entity_id: "sensor.a" }];
  assert.equal(areaHasAlert(hass, data2), false);
});

test("areaIsEmpty: a room with nothing classified stays empty", () => {
  assert.equal(areaIsEmpty(emptyAreaData()), true);
});

test("areaIsEmpty: a room whose only entity is a button is not empty", () => {
  const data = emptyAreaData();
  data.buttons = [{ entity_id: "button.fan_power" }];
  assert.equal(areaIsEmpty(data), false);
});
