// Run: node --test www/atrium/lib/ha-actions.test.js
import test from "node:test";
import assert from "node:assert/strict";

const { callService, toggleLights } = await import("./ha-actions.js");

function makeHass(states = {}) {
  const calls = [];
  return { states, callService: (...a) => calls.push(a), calls };
}

test("callService forwards to hass and no-ops when hass is missing", () => {
  const hass = makeHass();
  callService(hass, "light", "turn_on", { entity_id: "light.a" });
  assert.deepEqual(hass.calls, [["light", "turn_on", { entity_id: "light.a" }]]);
  assert.doesNotThrow(() => callService(undefined, "light", "turn_on", {}));
});

test("toggleLights turns off when any light is on, else on", () => {
  const onHass = makeHass({ "light.a": { state: "off" }, "light.b": { state: "on" } });
  toggleLights(onHass, ["light.a", "light.b"]);
  assert.equal(onHass.calls[0][1], "turn_off");

  const offHass = makeHass({ "light.a": { state: "off" } });
  toggleLights(offHass, ["light.a"]);
  assert.equal(offHass.calls[0][1], "turn_on");
});
