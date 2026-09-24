import test from "node:test";
import assert from "node:assert/strict";
import "../../tools/register.mjs";

const { lightRgbTriple, iconForSensor, fmtTimeAgoLong, computeSceneGradient, labelDescriptor, nameWithoutAreaPrefix } = await import("./area-card-shared.js");

test("nameWithoutAreaPrefix: strips the area name regardless of case (humanized fallback names are lower-case)", () => {
  const area = { name: "Living Room" };
  assert.equal(nameWithoutAreaPrefix("living room main", area), "Main");
  assert.equal(nameWithoutAreaPrefix("Living Room Lamp", area), "Lamp");
});

test("nameWithoutAreaPrefix: only strips a leading match, not one in the middle of the name", () => {
  const area = { name: "Fan" };
  assert.equal(nameWithoutAreaPrefix("Bedroom Fan Speed", area), "Bedroom Fan Speed");
});

test("lightRgbTriple returns the rgb triple only for true color modes", () => {
  assert.deepEqual(
    lightRgbTriple({ attributes: { color_mode: "rgb", rgb_color: [10, 20, 30] } }),
    [10, 20, 30]
  );
  assert.equal(lightRgbTriple({ attributes: { color_mode: "color_temp", rgb_color: [1, 2, 3] } }), null);
  assert.equal(lightRgbTriple({ attributes: { color_mode: "rgb" } }), null);
  assert.equal(lightRgbTriple(undefined), null);
});

test("iconForSensor: explicit icon > device_class map > gauge fallback", () => {
  assert.equal(iconForSensor({ attributes: { icon: "mdi:custom" } }), "mdi:custom");
  assert.equal(iconForSensor({ attributes: { device_class: "humidity" } }), "mdi:water-percent");
  assert.equal(iconForSensor({ attributes: { device_class: "nonsense" } }), "mdi:gauge");
  assert.equal(iconForSensor(undefined), "mdi:gauge");
});

test("fmtTimeAgoLong buckets recent timestamps", () => {
  assert.equal(fmtTimeAgoLong(Date.now()), "just now");
  assert.equal(fmtTimeAgoLong(Date.now() - 5 * 60 * 1000), "5 minutes ago");
  assert.equal(fmtTimeAgoLong(Date.now() - 3 * 3600 * 1000), "3 hours ago");
});

test("computeSceneGradient: mixes one stop per 'on' light the scene targets, skipping switches/covers/off lights", () => {
  const hass = {
    states: {
      "scene.movie": { attributes: { entity_id: ["light.a", "light.b", "light.c", "switch.d"] } },
      "light.a": { state: "on", attributes: { color_mode: "rgb", rgb_color: [10, 20, 30] } },
      "light.b": { state: "on", attributes: { color_mode: "brightness" } },
      "light.c": { state: "off", attributes: { color_mode: "rgb", rgb_color: [1, 2, 3] } },
      "switch.d": { state: "on", attributes: {} },
    },
  };
  assert.equal(
    computeSceneGradient(hass, "scene.movie"),
    "linear-gradient(90deg, rgb(10 20 30 / 0.35), rgb(var(--rgb-state-light-active-color, 245 196 81) / 0.3))"
  );
});

test("computeSceneGradient: a single contributing light still produces a 2-stop gradient", () => {
  const hass = {
    states: {
      "scene.reading": { attributes: { entity_id: ["light.a"] } },
      "light.a": { state: "on", attributes: { color_mode: "rgb", rgb_color: [200, 100, 50] } },
    },
  };
  assert.equal(
    computeSceneGradient(hass, "scene.reading"),
    "linear-gradient(90deg, rgb(200 100 50 / 0.35), rgb(200 100 50 / 0.35))"
  );
});

test("computeSceneGradient: no contributing lights (all off, or none listed) returns null", () => {
  const hass = {
    states: {
      "scene.allOff": { attributes: { entity_id: ["light.a"] } },
      "light.a": { state: "off", attributes: {} },
      "scene.noEntities": {},
      "scene.switchOnly": { attributes: { entity_id: ["switch.a"] } },
      "switch.a": { state: "on", attributes: {} },
    },
  };
  assert.equal(computeSceneGradient(hass, "scene.allOff"), null);
  assert.equal(computeSceneGradient(hass, "scene.noEntities"), null);
  assert.equal(computeSceneGradient(hass, "scene.switchOnly"), null);
  assert.equal(computeSceneGradient(hass, "scene.missing"), null);
});

test("labelDescriptor: a label with no custom icon gets no icon fallback (most labels never set one)", () => {
  const hass = { labels: { important: { name: "Important", color: "amber" } } };
  const desc = labelDescriptor(hass, "important");
  assert.equal(desc.icon, null);
  assert.equal(desc.name, "Important");
});

test("labelDescriptor: a label with a custom icon keeps it", () => {
  const hass = { labels: { important: { name: "Important", color: "amber", icon: "mdi:star" } } };
  const desc = labelDescriptor(hass, "important");
  assert.equal(desc.icon, "mdi:star");
});
