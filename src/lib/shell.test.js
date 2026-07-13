// shell.js imports shell.css, so the text loader has to be registered before
// the module graph resolves — hence the dynamic import.
import test from "node:test";
import assert from "node:assert/strict";
import "../../tools/register.mjs";

const { shellWeatherIcon, shellPickWeatherEntity, shellWeatherSummary } = await import("./shell.js");

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
