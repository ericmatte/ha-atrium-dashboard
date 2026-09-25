import test from "node:test";
import assert from "node:assert/strict";
import "../../tools/register.mjs";

const { lightRgbTriple, iconForSensor, fmtTimeAgoLong, lightsGradient, labelDescriptor, nameWithoutAreaPrefix } = await import("./area-card-shared.js");

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

test("lightsGradient: one dimmed stop per light that's on, skipping off lights and non-lights", () => {
  const hass = {
    states: {
      "light.a": { state: "on", attributes: { color_mode: "rgb", rgb_color: [255, 0, 0] } },
      "light.b": { state: "on", attributes: { color_mode: "color_temp" } },
      "light.c": { state: "off", attributes: {} },
    },
  };
  assert.equal(
    lightsGradient(hass, ["light.a", "light.b", "light.c", "switch.fan"]),
    "linear-gradient(90deg, rgb(255 0 0 / 0.35), rgb(var(--rgb-state-light-active-color, 245 196 81) / 0.3))"
  );
});

test("lightsGradient: a single light still produces a 2-stop gradient; none on → null", () => {
  const hass = { states: { "light.a": { state: "on", attributes: { color_mode: "rgb", rgb_color: [0, 0, 255] } }, "light.b": { state: "off", attributes: {} } } };
  assert.equal(lightsGradient(hass, ["light.a"]), "linear-gradient(90deg, rgb(0 0 255 / 0.35), rgb(0 0 255 / 0.35))");
  assert.equal(lightsGradient(hass, ["light.b"]), null);
  assert.equal(lightsGradient(hass, []), null);
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
