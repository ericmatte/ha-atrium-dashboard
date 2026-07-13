// area-card.js is a custom element with no direct exports (it only calls
// customElements.define at the bottom). Stub the browser globals it touches
// at import time (HTMLElement, customElements) so the module graph can load
// under plain Node, then grab the registered class out of the
// customElements.define() call.
import test from "node:test";
import assert from "node:assert/strict";
import "../../tools/register.mjs";

globalThis.HTMLElement = class {};
globalThis.window = globalThis;
let registered;
globalThis.customElements = { define: (_tag, cls) => { registered = cls; } };

await import("./area-card.js");
const AtriumAreaCard = registered;

function makeCard() {
  return Object.create(AtriumAreaCard.prototype);
}

test("_classify: a binary_sensor with no motion/leak/door device_class and no shared device lands in sensors.other", () => {
  const card = makeCard();
  card._hass = {
    states: { "binary_sensor.mystery": { state: "on", attributes: {} } },
  };
  const area = { area_id: "kitchen" };
  const data = card._classify(area, [{ entity_id: "binary_sensor.mystery" }]);
  assert.equal(data.sensors.other.length, 1);
  assert.equal(data.sensors.other[0].entity_id, "binary_sensor.mystery");
});

test("_areaIsEmpty: a room whose only entity is a non-device-linked 'other' binary_sensor is not empty (regression)", () => {
  const card = makeCard();
  const data = card._emptyData();
  data.sensors.other = [{ entity_id: "binary_sensor.mystery" }];
  assert.equal(card._areaIsEmpty(data), false);
});

test("_areaIsEmpty: a room with nothing classified stays empty", () => {
  const card = makeCard();
  assert.equal(card._areaIsEmpty(card._emptyData()), true);
});

test("_filterData: a 'sensors' section profile keeps sensors.other alongside extras", () => {
  const card = makeCard();
  card._sections = new Set(["sensors"]);
  card._exclude = null;
  const data = card._emptyData();
  data.sensors.other = [{ entity_id: "binary_sensor.mystery" }];
  data.sensors.extras = [{ entity_id: "sensor.co2" }];
  const filtered = card._filterData(data);
  assert.equal(filtered.sensors.other.length, 1);
  assert.equal(filtered.sensors.extras.length, 1);
});

test("_layoutMasonry: reads every card's natural height before writing any stack styles (no interleaved reflow)", () => {
  const ops = [];
  function makeMockCard(className, height) {
    return {
      className,
      style: { setProperty: (name) => ops.push(["write", name]) },
      get offsetHeight() {
        ops.push(["read"]);
        return height;
      },
    };
  }
  function makeMockCol() {
    const children = [];
    return {
      className: "",
      offsetHeight: 0,
      appendChild: (child) => children.push(child),
      querySelectorAll: () => children,
    };
  }

  const prevDocument = globalThis.document;
  const prevGetComputedStyle = globalThis.getComputedStyle;
  globalThis.document = { createElement: () => makeMockCol() };
  globalThis.getComputedStyle = () => ({
    getPropertyValue: (name) => ({ "--floor-peek-strip": "48", "--atrium-cols": "1" })[name] || "",
  });

  try {
    const cardEl = makeCard();
    const bodyEl = { classList: { contains: () => false, add() {}, remove() {} } };
    const root = { replaceChildren() {}, appendChild() {} };
    cardEl._root = root;
    cardEl._bodyEl = bodyEl;
    cardEl._roomCards = [
      makeMockCard("atrium-room", 100),
      makeMockCard("atrium-room", 150),
      makeMockCard("atrium-room", 80),
    ];

    cardEl._layoutMasonry();

    const lastReadIndex = ops.findLastIndex(([type]) => type === "read");
    const firstWriteIndex = ops.findIndex(([type]) => type === "write");
    assert.ok(ops.some(([type]) => type === "read"), "expected at least one height read");
    assert.ok(ops.some(([type]) => type === "write"), "expected at least one style write");
    assert.ok(
      lastReadIndex < firstWriteIndex,
      `expected all height reads to happen before any style write, got order: ${JSON.stringify(ops)}`,
    );
  } finally {
    globalThis.document = prevDocument;
    globalThis.getComputedStyle = prevGetComputedStyle;
  }
});

function makeClimateCard(attributes) {
  const card = makeCard();
  const calls = [];
  card._hass = { states: { "climate.x": { state: "cool", attributes } } };
  card._call = (domain, service, data) => calls.push({ domain, service, data });
  return { card, calls };
}

test("_adjustClimate: an entity with target_temp_step 1 moves by a full degree", () => {
  const { card, calls } = makeClimateCard({ temperature: 20, target_temp_step: 1, min_temp: 16, max_temp: 29 });
  card._adjustClimate("climate.x", 1);
  card._adjustClimate("climate.x", -1);
  assert.deepEqual(calls.map((c) => c.data.temperature), [21, 19]);
});

test("_adjustClimate: an entity with no target_temp_step falls back to half-degree steps", () => {
  const { card, calls } = makeClimateCard({ temperature: 16, min_temp: 0, max_temp: 50 });
  card._adjustClimate("climate.x", 1);
  card._adjustClimate("climate.x", -1);
  assert.deepEqual(calls.map((c) => c.data.temperature), [16.5, 15.5]);
});

test("_adjustClimate: the setpoint stays within min_temp/max_temp", () => {
  const { card: atMax, calls: maxCalls } = makeClimateCard({ temperature: 29, target_temp_step: 1, min_temp: 16, max_temp: 29 });
  atMax._adjustClimate("climate.x", 1);
  assert.deepEqual(maxCalls, []);

  const { card: atMin, calls: minCalls } = makeClimateCard({ temperature: 16, target_temp_step: 1, min_temp: 16, max_temp: 29 });
  atMin._adjustClimate("climate.x", -1);
  assert.deepEqual(minCalls, []);
});

test("_adjustClimate: an off-grid setpoint snaps onto the device's step grid", () => {
  const { card, calls } = makeClimateCard({ temperature: 20.5, target_temp_step: 1, min_temp: 16, max_temp: 29 });
  card._adjustClimate("climate.x", -1);
  assert.deepEqual(calls.map((c) => c.data.temperature), [20]);
});
