// shell.js imports shell.css, so the text loader has to be registered before
// the module graph resolves — hence the dynamic import.
import test from "node:test";
import assert from "node:assert/strict";
import "../../tools/register.mjs";

const { shellWeatherIcon, shellWeatherColor, shellPickWeatherEntity, shellWeatherSummary, shellGreeting } = await import("./shell.js");

test("shellGreeting: night 10pm–4am, morning until noon, afternoon until 6pm, evening until 10pm", () => {
  assert.equal(shellGreeting(0), "Good night");
  assert.equal(shellGreeting(3), "Good night");
  assert.equal(shellGreeting(4), "Good morning");
  assert.equal(shellGreeting(11), "Good morning");
  assert.equal(shellGreeting(12), "Good afternoon");
  assert.equal(shellGreeting(17), "Good afternoon");
  assert.equal(shellGreeting(18), "Good evening");
  assert.equal(shellGreeting(21), "Good evening");
  assert.equal(shellGreeting(22), "Good night");
  assert.equal(shellGreeting(23), "Good night");
});


function weatherState(entityId, state, attributes = {}) {
  return { entity_id: entityId, state, attributes };
}

function makeHass({ states = {}, entities = {} } = {}) {
  return { states, entities };
}

test("shellWeatherIcon maps known conditions", () => {
  assert.equal(shellWeatherIcon("partlycloudy"), "mdi:weather-partly-cloudy");
  assert.equal(shellWeatherIcon("clear-night"), "mdi:weather-night");
  assert.equal(shellWeatherIcon("pouring"), "mdi:weather-pouring");
});

test("shellWeatherIcon falls back for unknown conditions", () => {
  assert.equal(shellWeatherIcon("meteor-shower"), "mdi:weather-cloudy");
  assert.equal(shellWeatherIcon(undefined), "mdi:weather-cloudy");
});

test("shellWeatherColor maps known conditions to distinct colors", () => {
  assert.equal(shellWeatherColor("sunny"), "#f5a623");
  assert.equal(shellWeatherColor("rainy"), "#5b9bd9");
  assert.notEqual(shellWeatherColor("sunny"), shellWeatherColor("rainy"));
});

test("shellWeatherColor falls back for unknown conditions", () => {
  assert.equal(shellWeatherColor("meteor-shower"), shellWeatherColor(undefined));
});

test("shellPickWeatherEntity returns null without weather entities", () => {
  const hass = makeHass({ states: { "sensor.temp": weatherState("sensor.temp", "19") } });
  assert.equal(shellPickWeatherEntity(hass), null);
});

test("shellPickWeatherEntity prefers weather.home", () => {
  const hass = makeHass({
    states: {
      "weather.aaa_first": weatherState("weather.aaa_first", "sunny"),
      "weather.home": weatherState("weather.home", "partlycloudy"),
    },
  });
  assert.equal(shellPickWeatherEntity(hass), "weather.home");
});

test("shellPickWeatherEntity prefers weather.forecast_home over alphabetical", () => {
  const hass = makeHass({
    states: {
      "weather.aaa_first": weatherState("weather.aaa_first", "sunny"),
      "weather.forecast_home": weatherState("weather.forecast_home", "cloudy"),
    },
  });
  assert.equal(shellPickWeatherEntity(hass), "weather.forecast_home");
});

test("shellPickWeatherEntity is alphabetical otherwise", () => {
  const hass = makeHass({
    states: {
      "weather.zulu": weatherState("weather.zulu", "sunny"),
      "weather.alpha": weatherState("weather.alpha", "cloudy"),
    },
  });
  assert.equal(shellPickWeatherEntity(hass), "weather.alpha");
});

test("shellPickWeatherEntity skips hidden and unavailable entities", () => {
  const hass = makeHass({
    states: {
      "weather.home": weatherState("weather.home", "unavailable"),
      "weather.hidden_one": weatherState("weather.hidden_one", "sunny"),
      "weather.visible": weatherState("weather.visible", "cloudy"),
    },
    entities: {
      "weather.hidden_one": { entity_id: "weather.hidden_one", hidden: true },
    },
  });
  assert.equal(shellPickWeatherEntity(hass), "weather.visible");
});

test("shellWeatherSummary returns icon and rounded temperature", () => {
  const hass = makeHass({
    states: {
      "weather.home": weatherState("weather.home", "partlycloudy", {
        temperature: 19.5,
        friendly_name: "Forecast Home",
      }),
    },
  });
  assert.deepEqual(shellWeatherSummary(hass), {
    entityId: "weather.home",
    condition: "partlycloudy",
    icon: "mdi:weather-partly-cloudy",
    color: shellWeatherColor("partlycloudy"),
    label: "19.5°",
  });
});

test("shellWeatherSummary returns null without a usable temperature", () => {
  const noTemp = makeHass({
    states: { "weather.home": weatherState("weather.home", "sunny") },
  });
  assert.equal(shellWeatherSummary(noTemp), null);

  const badTemp = makeHass({
    states: { "weather.home": weatherState("weather.home", "sunny", { temperature: "n/a" }) },
  });
  assert.equal(shellWeatherSummary(badTemp), null);
});

test("shellWeatherSummary returns null when there is no weather entity", () => {
  assert.equal(shellWeatherSummary(makeHass()), null);
});

const { shellGroupOffline } = await import("./shell.js");

test("shellGroupOffline: a device whose every entity is offline becomes one row named after it, with its count", () => {
  const st = (id, state) => ({ entity_id: id, state, attributes: { friendly_name: id } });
  const hass = {
    states: {
      "switch.plug": st("switch.plug", "unavailable"),
      "sensor.plug_power": st("sensor.plug_power", "unavailable"),
      "sensor.plug_energy": st("sensor.plug_energy", "unavailable"),
      "light.lamp": st("light.lamp", "unavailable"),
      "sensor.lamp_rssi": st("sensor.lamp_rssi", "-60"),
      "light.solo": st("light.solo", "unavailable"),
    },
    entities: {
      "switch.plug": { device_id: "d1" },
      "sensor.plug_power": { device_id: "d1" },
      "sensor.plug_energy": { device_id: "d1" },
      "light.lamp": { device_id: "d2" },
      "sensor.lamp_rssi": { device_id: "d2" },
      "light.solo": {},
    },
    devices: { d1: { name: "Shelly Plug", name_by_user: "Prise salon" }, d2: { name: "Lamp" } },
  };
  const problems = ["switch.plug", "sensor.plug_power", "sensor.plug_energy", "light.lamp", "light.solo"].map((id) => ({ id, kind: "unavailable", state: hass.states[id] }));
  const out = shellGroupOffline(problems, hass);
  assert.equal(out.length, 3);
  const plug = out.find((p) => p.device);
  assert.deepEqual({ id: plug.id, name: plug.device, count: plug.count }, { id: "switch.plug", name: "Prise salon", count: 3 });
  // A device with another entity still online keeps its offline ones apart.
  assert.ok(out.some((p) => p.id === "light.lamp" && !p.device));
  assert.ok(out.some((p) => p.id === "light.solo" && !p.device));
});

test("shellGroupOffline: an active problem is never folded into its device", () => {
  const hass = { states: { "binary_sensor.leak": { state: "on", attributes: {} } }, entities: { "binary_sensor.leak": { device_id: "d1" } }, devices: { d1: { name: "Leak" } } };
  const problems = [{ id: "binary_sensor.leak", kind: "problem", state: hass.states["binary_sensor.leak"] }];
  assert.deepEqual(shellGroupOffline(problems, hass), problems);
});

test("shellGroupOffline: buttons and selects, which some integrations never mark offline, do not keep a device apart", () => {
  const hass = {
    states: {
      "vacuum.roby": { state: "unavailable", attributes: {} },
      "sensor.roby_battery": { state: "unavailable", attributes: {} },
      "button.roby_identify": { state: "2026-04-09T02:52:41+00:00", attributes: {} },
      "select.roby_mode": { state: "Strong", attributes: {} },
    },
    entities: {
      "vacuum.roby": { device_id: "r" },
      "sensor.roby_battery": { device_id: "r" },
      "button.roby_identify": { device_id: "r" },
      "select.roby_mode": { device_id: "r" },
    },
    devices: { r: { name: "Roby" } },
  };
  const problems = ["vacuum.roby", "sensor.roby_battery"].map((id) => ({ id, kind: "unavailable", state: hass.states[id] }));
  const out = shellGroupOffline(problems, hass);
  assert.equal(out.length, 1);
  assert.equal(out[0].device, "Roby");
  assert.equal(out[0].count, 2);
});
